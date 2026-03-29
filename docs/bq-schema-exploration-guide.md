# BigQuery Schema Documentation — Exploration Guide

> **Purpose**: Phased investigation plan for Claude Code to systematically explore the Savvy Wealth dashboard codebase and BigQuery schema, producing four static reference documents that eliminate redundant schema rediscovery across agentic sessions.
>
> **Context**: Savvy Wealth is a tech-enabled RIA (Registered Investment Advisor) that recruits financial advisors as 1099 contractors. The dashboard tracks advisor prospects through a recruiting funnel from initial contact to joining the firm. All analytics data flows from Salesforce → BigQuery (every 6 hours) → Next.js dashboard.
>
> **Output Destination**: `.claude/` directory as project knowledge files
>
> **Agent Constraints**:
> - DO NOT modify any BigQuery views, tables, or data
> - DO NOT modify any application code
> - Read-only investigation — write only to `.claude/` and `docs/` directories
> - Use BigQuery MCP for schema inspection queries only

---

## Final Deliverables

This exploration produces four markdown files:

| File | Purpose | Lives At |
|------|---------|----------|
| `bq-views.md` | View registry — name, purpose, consumers | `.claude/bq-views.md` |
| `bq-field-dictionary.md` | Field-level definitions with business context and "why" | `.claude/bq-field-dictionary.md` |
| `bq-patterns.md` | Recurring query patterns, gotchas, tribal knowledge | `.claude/bq-patterns.md` |
| `bq-salesforce-mapping.md` | SF object → BQ table mapping, sync cadence, derived vs raw fields, FinTrx pipeline | `.claude/bq-salesforce-mapping.md` |

Each phase below ends with questions. After investigating, write your findings directly below each question in a `> **Finding:**` block. After all phases are complete, use the accumulated findings to generate the four deliverables.

---

## Phase 1: View Inventory & Consumer Mapping

**Goal**: Catalog every BigQuery view, its purpose, and which dashboard pages/features consume it.

### 1.1 — Enumerate All Views

Read the SQL definitions for every view in the `views/` directory:

```
views/vw_funnel_master.sql
views/vw_forecast_p2.sql
views/vw_lost_to_competition.sql
views/vw_joined_advisor_location.sql
views/vw_sga_activity_performance_v2.sql
```

Also check BigQuery directly for any views not captured in local SQL files:

```sql
SELECT table_name, table_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.TABLES`
WHERE table_type = 'VIEW'
ORDER BY table_name;
```

And check all datasets for views:

```sql
SELECT table_schema, table_name
FROM `savvy-gtm-analytics.INFORMATION_SCHEMA.TABLES`
WHERE table_type = 'VIEW'
ORDER BY table_schema, table_name;
```

**Q1.1a**: What are ALL views across all datasets? List each with its dataset and a one-sentence description of what it computes (read the SQL).

> **Finding:** **Tableau_Views** (9 views): `vw_funnel_master` (Lead+Opp funnel SSOT), `vw_forecast_p2` (deterministic pipeline forecast), `vw_funnel_audit` (stage velocity/audit trail), `vw_daily_forecast` (daily-ized forecast goals), `vw_joined_advisor_location` (joined advisor addresses+geocoding), `vw_lost_to_competition` (CRD-matched competitor movement), `vw_sga_activity_performance` (Task-based SGA activity categorization), `vw_channel_conversion_rates_pivoted` (Tableau-only), `vw_channel_funnel_volume_by_month` (Tableau-only). **savvy_analytics** (48 views): Mostly Tableau/analytics. Dashboard-consumed: `vw_sga_sms_timing_analysis_v2`, `vw_sga_closed_lost_sql_followup`, `vw_sga_activity_performance`, `vw_daily_forecast`. **SavvyGTMData** (8 views): All external/legacy — `fintrx_clean`, `broker_protocol_*`, `vw_sga_funnel*`, `XYPN_view`.

**Q1.1b**: Are there any views in BigQuery that don't have corresponding `.sql` files in the `views/` directory?

> **Finding:** Yes — 4 Tableau_Views views have no local SQL: `vw_channel_conversion_rates_pivoted`, `vw_channel_funnel_volume_by_month`, `vw_daily_forecast`, `vw_funnel_audit`. Also, the local file is `vw_sga_activity_performance_v2.sql` but the BQ view is named `vw_sga_activity_performance` (no v2 suffix). All 48 savvy_analytics views and 8 SavvyGTMData views also lack local SQL files.

### 1.2 — Map Views to Dashboard Consumers

Search the codebase for every reference to each view name. For each view, identify which API routes, query files, and dashboard pages consume it.

```bash
# Run for each view name discovered in 1.1
grep -rn "vw_funnel_master\|Tableau_Views\." src/lib/queries/ --include="*.ts"
grep -rn "vw_funnel_master\|Tableau_Views\." src/app/api/ --include="*.ts"
```

Also check `src/config/constants.ts` for any table/view name constants.

**Q1.2a**: For each view, which query files (`src/lib/queries/*.ts`) reference it?

> **Finding:** `vw_funnel_master`: funnel-metrics, conversion-rates, detail-records, drill-down, open-pipeline, source-performance, export-records, forecast-rates, forecast-monte-carlo, forecast-pipeline, sga-activity, sga-leaderboard, sgm-quota, sgm-dashboard, quarterly-progress, pipeline-catcher, filter-options, weekly-actuals, closed-lost, re-engagement, advisor-locations, semantic-layer. `vw_forecast_p2`: forecast-pipeline, forecast-export. `vw_daily_forecast`: forecast-goals, semantic-layer/query-templates. `vw_funnel_audit`: forecast-export. `vw_joined_advisor_location`: advisor-locations. `vw_lost_to_competition`: reporting agents only (not query files). `vw_sga_activity_performance`: sga-activity.

**Q1.2b**: For each view, which API routes (`src/app/api/`) consume those query files? And which dashboard pages do those API routes serve?

> **Finding:** `vw_funnel_master` → nearly all API routes → Funnel Performance, SGA Performance, SGM Hub, Open Pipeline, Source Performance, Quarterly Progress, Leaderboards, Export, Games, Explore AI. `vw_forecast_p2` → `/api/forecast/*` → Forecast page. `vw_daily_forecast` → `/api/forecast/goals` → Goal progress bars. `vw_funnel_audit` → `/api/forecast/record/[id]`, `/api/forecast/export` → Deal detail view, Sheets export. `vw_joined_advisor_location` → `/api/advisor-locations`, `/api/cron/geocode-advisors` → Advisor Map page. `vw_sga_activity_performance` → `/api/sga-activity/*` → SGA Activity page.

**Q1.2c**: Are there any views that are NOT consumed by the dashboard at all (orphaned views, Tableau-only, or used by external tools like Hightouch)?

> **Finding:** Yes — `vw_channel_conversion_rates_pivoted` and `vw_channel_funnel_volume_by_month` (Tableau_Views) are not referenced anywhere in the Next.js codebase. Most of the 48 savvy_analytics views are Tableau-only or legacy. All 8 SavvyGTMData views are external. `vw_lost_to_competition` is only consumed by reporting agents (not dashboard pages directly).

### 1.3 — Map Raw Tables to Consumers

Also catalog the raw `SavvyGTMData.*` tables and any `FinTrx_data_CA.*` tables referenced in queries.

```bash
grep -rn "SavvyGTMData\.\|FinTrx_data_CA\." src/lib/queries/ --include="*.ts"
```

**Q1.3a**: Which raw tables are queried directly by the dashboard (not just consumed via views)?

> **Finding:** `User` (14+ query files — SGA/SGM name lookups, IsSGA flag), `Opportunity` (closed-lost, re-engagement, advisor-locations, forecast-pipeline), `Lead` (drill-down, weekly-actuals, filter-options), `Task` (sga-activity direct queries), `OpportunityFieldHistory` (forecast-pipeline PIT reconstruction, forecast-date-revisions), `Campaign` (filter-options), `CampaignMember` (filter-options), `Account` (advisor-locations for address/AUM), `new_mapping` (drill-down, record-detail, quarterly-progress).

**Q1.3b**: What is the `new_mapping` table and how is it joined? What does it produce?

> **Finding:** `new_mapping` is a 2-column table (`original_source` STRING → `Channel_Grouping_Name` STRING) that maps lead sources to marketing channels. Joined via `LEFT JOIN new_mapping nm ON v.Original_source = nm.original_source`. Used with `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')`. **DEPRECATED** — `vw_funnel_master` now computes `Channel_Grouping_Name` inline from `Finance_View__c`. The `new_mapping` JOIN is still present in drill-down.ts, record-detail.ts, quarterly-progress.ts but should be migrated. **Human-verified**: `Finance_View__c` is the canonical channel source. Do not use `new_mapping` in new queries.

---

## Phase 2: Field-Level Schema Extraction

**Goal**: Extract every field from every view and key table, with data types and business meaning.

### 2.1 — vw_funnel_master Field Inventory

This is the primary view. Extract its complete schema:

```sql
SELECT column_name, data_type, is_nullable
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
ORDER BY ordinal_position;
```

Cross-reference with the view SQL (`views/vw_funnel_master.sql`) to understand which fields are:
- **Raw passthrough** from Salesforce (e.g., `SGA_Owner_Name__c`)
- **Computed/derived** in the view (e.g., `is_sqo_unique`, `eligible_for_mql_conversions`)
- **Joined from other tables** (e.g., `Channel_Grouping_Name` from `new_mapping`)

**Q2.1a**: List ALL fields in `vw_funnel_master` grouped by category: (1) raw SF Lead fields, (2) raw SF Opportunity fields, (3) computed flags, (4) joined/enriched fields. Include data types.

> **Finding:** 88 total fields. See `.claude/bq-field-dictionary.md` for the complete breakdown. Summary: (1) **Raw Lead**: Full_prospect_id__c, CreatedDate, stage_entered_contacting__c, mql_stage_entered_ts, converted_date_raw(DATE), Initial_Call_Scheduled_Date__c(DATE), Disposition__c, DoNotCall, Lead_Score_Tier__c, lead_closed_date, Next_Steps__c, lead_record_source. (2) **Raw Opp**: Full_Opportunity_ID__c, Opp_CreatedDate, Date_Became_SQO__c(TS), advisor_join_date__c(DATE), StageName, SQO_raw, all Stage_Entered_*__c(TS), Amount(F64), Underwritten_AUM__c(F64), Actual_ARR__c(F64), SGM_Estimated_ARR__c(F64), Earliest_Anticipated_Start_Date__c(DATE), recordtypeid, Closed_Lost_Reason__c, NextStep. (3) **Computed**: is_contacted, is_mql, is_sql, is_sqo, is_joined, is_primary_opp_record, is_sqo_unique, is_joined_unique, opp_row_num, all eligible_for_* flags, all *_progression flags, TOF_Stage, Conversion_Status, StageName_code, aum_tier, Opportunity_AUM_M, *_cohort_month fields, record_type_name. (4) **Joined/Enriched**: Channel_Grouping_Name (from Finance_View__c CASE), SGA_Owner_Name__c (COALESCE lead+opp), SGM_Owner_Name__c (from Opp), Original_source (COALESCE), Opp_SGA_User_Name (User join), Campaign_Name__c (Campaign join), all_campaigns (CampaignMember join), Account_Total_ARR__c (Account join).

**Q2.1b**: For each computed field, what is the exact CASE/logic used? (Focus on the deduplication flags, eligibility flags, and progression flags — these are the ones agents get wrong most often.)

> **Finding:** See `.claude/bq-field-dictionary.md` "Deduplication Flags", "Eligibility Flags", and "Progression Flags" sections for exact logic. Key: `is_sqo_unique = is_sqo AND opp_row_num=1`, `eligible_for_sql_conversions = is_sql AND (SQO_raw='yes' OR StageName='Closed Lost')` with special case for opp-only records, `sqo_to_joined_progression = SQO_raw='yes' AND is_joined AND StageName!='Closed Lost'`. The `eligible_for_contacted_conversions_30d` adds a 30-day timeout rule for unresolved contacts.

### 2.2 — Semantic Layer Cross-Reference

Read the semantic layer definitions to understand how the dashboard names and describes fields:

```bash
cat src/lib/semantic-layer/definitions.ts
cat src/lib/semantic-layer/query-compiler.ts
cat src/lib/semantic-layer/query-templates.ts
```

**Q2.2a**: What metrics and dimensions are defined in the semantic layer? How do they map to `vw_funnel_master` fields?

> **Finding:** **Volume Metrics** (9): prospects, contacted, mqls, sqls, sqos, joined, initial_calls_scheduled, qualification_calls, closed_lost, signed. **AUM Metrics** (5): sqo_aum, joined_aum, signed_aum, open_pipeline_aum, avg_aum. **Conversion Metrics** (4): contacted_to_mql_rate, mql_to_sql_rate, sql_to_sqo_rate, sqo_to_joined_rate (all cohort mode only). **Dimensions** (16): channel, source, sga, sgm, experimentation_tag, campaign, stage_name, aum_tier, record_type, tof_stage, lead_score_tier, external_agency, next_steps, opp_next_step, conversion_status, closed_lost_reason, campaign_name. **Time Dimensions** (4): quarter, month, week, year. **Date Ranges** (10): this/last quarter/month/week, ytd, last year, last 30/90 days, next week, custom. All map directly to vw_funnel_master fields.

**Q2.2b**: Are there any fields in `vw_funnel_master` that are NOT exposed through the semantic layer? If so, why might they be excluded?

> **Finding:** Many fields are not exposed: all URL fields (lead_url, opportunity_url, salesforce_url), opp_row_num, individual Stage_Entered_*__c timestamps (only the key stage date fields are used via DATE_FIELDS), all cohort_month fields, Experimentation_Tag_List (array, not directly queryable), Channel_Grouping_Name_Raw, Previous_Recruiting_Opportunity_ID__c, DoNotCall, Disposition__c, lead_closed_date, SQO_raw, individual ARR fields (Actual_ARR__c, SGM_Estimated_ARR__c, Account_Total_ARR__c), all_campaigns array. These are excluded because they're either internal implementation details, array types incompatible with simple SQL templates, or too granular for the AI agent's natural language interface.

### 2.3 — Other View Schemas

Repeat the schema extraction for each non-funnel-master view discovered in Phase 1:

```sql
-- Run for each view
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = '[VIEW_NAME]'
ORDER BY ordinal_position;
```

**Q2.3a**: For `vw_forecast_p2` — what fields does it expose? Which are raw vs computed? How does it differ from querying `vw_funnel_master` directly for pipeline data?

> **Finding:** 25 fields. Raw from vw_funnel_master: identifiers, names, stage, AUM, attribution. Computed: `p_join` (product of remaining historical stage rates), `expected_days_remaining`, `model_projected_join_date`, `final_projected_join_date` (COALESCE anticipated/model), `projected_quarter`, `expected_aum_weighted` (AUM*p_join), `days_in_current_stage`, individual rate columns (NULL'd for passed stages), `stages_remaining`. Key difference from querying vw_funnel_master: the view pre-computes conversion probabilities from a Jun-Dec 2025 resolved cohort (Joined + Closed Lost only, excluding open deals to avoid deflating rates), and projects timelines. The client-side `computeAdjustedDeal()` then applies duration penalties and AUM-tiered adjustments on top.

**Q2.3b**: For `vw_lost_to_competition` — what data sources does it join (Salesforce opps + FinTrx regulatory data)? What is the CRD matching logic?

> **Finding:** 12 fields. Joins `SavvyGTMData.Opportunity` (direct, not via vw_funnel_master) with `FinTrx_data_CA.ria_contacts_current`. CTE `closed_lost_sqos` selects Closed Lost SQOs (`SQL__c='Yes' AND StageName='Closed Lost' AND FA_CRD__c IS NOT NULL`). CTE `fintrix_current` selects `CAST(RIA_CONTACT_CRD_ID AS STRING)` for join. INNER JOIN on CRD string, filtered `WHERE ft.current_firm_start_date > cls.closed_lost_date` (advisor moved after being lost). Computes `months_to_move = DATE_DIFF / 30.44`. Key output: `moved_to_firm` (the competitor).

**Q2.3c**: For `vw_joined_advisor_location` — what fields does it expose and what geocoding/address logic does it contain?

> **Finding:** 29 fields. Starts from vw_funnel_master joined advisors (`is_joined_unique=1, advisor_join_date__c > 2018-01-01`). Address COALESCE priority: Contact → FinTrx → Account. Joins: Opportunity (for ContactId, AccountId, FA_CRD__c), Lead (aggregated CRD per opp), Contact (mailing address), Account (billing address), FinTrx ria_contacts_current (PRIMARY_LOCATION fields via CRD). State normalization: inline state_abbrev CTE maps full names to 2-letter abbreviations (US states + Canadian provinces). Lat/long: `COALESCE(sfdc_lat, geocoded_lat)` from `geocoded_addresses` table (populated by cron job). Flags: `has_full_address`, `has_address`, `address_source`, `coord_source`.

**Q2.3d**: For `vw_sga_activity_performance_v2` — what Salesforce Task fields does it use and how does it categorize activity types (calls, SMS, etc.)?

> **Finding:** Uses Task fields: Id, CreatedDate, Status, Subject, Type, TaskSubtype, CallDurationInSeconds, WhoId, WhatId, OwnerId. Joins to User (executor name) and vw_funnel_master (funnel context via WhoId=Lead or WhatId=Opp). Activity channel waterfall (priority order): Marketing → SMS → LinkedIn → Call → Email(Blast) → Email(Engagement/lemlist clicks) → Email(Campaign/lemlist/ListEmail) → Email(Manual) → Meeting → Other. Direction: Inbound (Incoming/Inbound/Submitted Form) vs Outbound. Quality signals: `is_meaningful_connect` (incoming SMS, answered calls, calls >120s), `is_true_cold_call` (first outbound call to pre-MQL prospect or 180+ day re-engagement, not scheduled, not self-reference). Dedup: When task links to both Lead and Opp, prefers Lead match. Ramp status: <=30 days from executor creation = "On Ramp".

### 2.4 — FinTrx Tables

Investigate the FinTrx dataset:

```sql
SELECT table_name
FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.TABLES`
ORDER BY table_name;
```

**Q2.4a**: What tables exist in the FinTrx dataset? Which ones are consumed by dashboard queries or views?

> **Finding:** 27 tables. Dashboard-consumed: `ria_contacts_current` (by vw_lost_to_competition and vw_joined_advisor_location for CRD matching and address enrichment), `advisor_segments` (by Hightouch outbound sync to SF Marketing_Segment__c). Others include: Firm_historicals, Historical_Disclosure_data, affiliates_historicals, contact_branch_data, contact_broker_dealer_state_historicals, contact_registered_employment_history, contact_state_registrations_historicals, custodians_historicals, firm_accolades_historicals, industry_exam_bd/ia_historicals, news_ps, passions_and_interests, platform_firms, private_fund_data, private_wealth_teams_ps, ria_contact_firm_relationships, ria_contact_news, ria_contact_university_details, ria_firms_current, ria_investors_news, ria_investors_private_fund_relationships, schedule_d_section_A/B_historicals, wealth_team_members.

**Q2.4b**: What is `advisor_segments` and how does it feed the Marketing_Segment__c Hightouch sync?

> **Finding:** `advisor_segments` is a BASE TABLE in FinTrx_data_CA (~790K rows) containing firm-type classifications. **Human-verified**: 4 segments — OTHER (420K), CAPTIVE_W2 (180K), INDEPENDENT_PLATFORM (96K), RIA_OWNER (94K). Purely categorical, no score field. Join key: `RIA_CONTACT_CRD_ID` (INT64) matched to Salesforce `FA_CRD__c` (STRING). Hightouch reads this table daily and syncs `advisor_segment` → `Marketing_Segment__c` on Lead, Contact, and Opportunity objects in Salesforce (diff-based, 0-50 rows per run). The dashboard does NOT query this table directly. **Critical distinction**: `Marketing_Segment__c` (firm-type from FinTrx) is NOT the same as `Lead_Score_Tier__c` (V4 XGBoost lead quality scoring). See Appendix: Human-Verified Context.

---

## Phase 3: Query Pattern Extraction

**Goal**: Identify recurring patterns, gotchas, and tribal knowledge embedded in the query files.

### 3.1 — Date Handling Patterns

```bash
grep -n "TIMESTAMP(\|DATE(\|converted_date_raw\|advisor_join_date\|Date_Became_SQO\|FilterDate\|stage_entered_contacting\|mql_stage_entered" src/lib/queries/*.ts | head -100
```

**Q3.1a**: Which fields require `DATE()` wrappers vs `TIMESTAMP()` wrappers? Document the complete list with the correct wrapper for each.

> **Finding:** **DATE fields** (use `DATE()` wrapper): `converted_date_raw`, `advisor_join_date__c`, `Qualification_Call_Date__c`, `Initial_Call_Scheduled_Date__c`, `Earliest_Anticipated_Start_Date__c`. **TIMESTAMP fields** (use `TIMESTAMP()` wrapper): `FilterDate`, `stage_entered_contacting__c`, `mql_stage_entered_ts`, `Date_Became_SQO__c`, `Stage_Entered_Discovery__c`, `Stage_Entered_Sales_Process__c`, `Stage_Entered_Negotiating__c`, `Stage_Entered_Signed__c`, `Stage_Entered_On_Hold__c`, `Stage_Entered_Closed__c`, `Stage_Entered_Joined__c`, `lead_closed_date`, `CreatedDate`, `Opp_CreatedDate`. See `.claude/bq-field-dictionary.md` for the complete table.

**Q3.1b**: How does the separate `startDate`/`startDateTimestamp` parameter pattern work in queries that use both DATE and TIMESTAMP fields? Which files use this pattern?

> **Finding:** Most queries pass a single `@startDate` string parameter and apply both `DATE(@startDate)` and `TIMESTAMP(@startDate)` wrappers as needed. BigQuery handles the implicit cast. Some queries append `' 23:59:59'` to end dates for inclusive TIMESTAMP comparisons: `TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))`. The separate timestamp parameter pattern is rare — most files just use the single param with appropriate wrappers. The semantic layer explicitly documents this in `DATE_FIELDS` with type annotations per field.

### 3.2 — Deduplication Patterns

```bash
grep -n "is_sqo_unique\|is_joined_unique\|is_primary_opp_record\|opp_row_num\|is_sqo\b\|is_joined\b" src/lib/queries/*.ts
```

**Q3.2a**: When do you use `is_sqo_unique` vs `is_sqo`? When `is_joined_unique` vs `is_joined`? When `is_primary_opp_record`? Document the rule for each.

> **Finding:** `is_sqo_unique`: **Volume counts** (scorecard SQO number). One count per opportunity. Used in: funnel-metrics, open-pipeline, quarterly-progress, sga-leaderboard, detail-records, forecast. `is_sqo`: **Rate calculations** — the per-record flag used by progression/eligibility flags. `is_joined_unique`: **Volume counts** (scorecard Joined number). `is_joined`: **Rate calculations** and binary flag. `is_primary_opp_record`: **AUM aggregation** — used in `SUM(CASE WHEN is_primary_opp_record = 1 THEN Opportunity_AUM...)` to avoid double-counting AUM. Also used for Signed stage dedup. Distinct from `is_sqo_unique` because it's 1 for lead-only rows too. See `.claude/bq-patterns.md` Deduplication section.

### 3.3 — Record Type Filtering

```bash
grep -n "recordtypeid\|RECRUITING_RECORD_TYPE\|RE_ENGAGEMENT_RECORD_TYPE\|012Dn000000mrO3IAI\|012VS000009VoxrYAC" src/lib/queries/*.ts src/config/constants.ts
```

**Q3.3a**: Which queries require the recruiting record type filter? Which require re-engagement? Are there queries that intentionally omit the filter and why?

> **Finding:** **Recruiting filter required** (`012Dn000000mrO3IAI`): All SQO, Joined, Signed, AUM, and open pipeline queries — conversion-rates (SQO/Joined sections), funnel-metrics (SQO/Joined), drill-down (SQO drill), open-pipeline (all), quarterly-progress, pipeline-catcher, sga-leaderboard, admin-quarterly-progress, forecast-monte-carlo. **Re-Engagement filter** (`012VS000009VoxrYAC`): closed-lost.ts (checks re-engagement opps for re-engagement context), re-engagement.ts (re-engagement pipeline). **Intentionally omitted**: Lead-level metrics (Prospects, Contacted, MQL, SQL) — these count ALL record types because re-engagement records are UNION ALL'd into All_Leads via the ReEngagement_As_Lead CTE. **Human-verified**: Re-engagement records ARE included in lead-level counts and DO affect denominators. Filter on `lead_record_source = 'Lead'` to exclude them, or `lead_record_source = 'Re-Engagement'` for re-engagement only. See Appendix: Human-Verified Context.

### 3.4 — Channel and Source Patterns

```bash
grep -n "Channel_Grouping_Name\|Original_source\|new_mapping\|Finance_View__c\|Cohort_source\|COALESCE.*channel\|COALESCE.*nm\." src/lib/queries/*.ts
```

**Q3.4a**: What is the current canonical pattern for channel grouping? Is it `Channel_Grouping_Name` via `new_mapping`, `Finance_View__c` direct, or something else? Are there queries still using the old pattern?

> **Finding:** **Current canonical**: `Finance_View__c` direct from Salesforce is the source of truth for channel grouping. `v.Channel_Grouping_Name` in the view is computed inline from `Finance_View__c` via CASE statement. Used by: conversion-rates, export-records, filter-options, advisor-locations, admin-quarterly-progress, semantic layer. **DEPRECATED pattern still present**: `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` with `new_mapping` JOIN. Used by: drill-down.ts, record-detail.ts, quarterly-progress.ts. These should be migrated. **Human-verified**: `Finance_View__c` is canonical. `new_mapping` JOIN is deprecated. `Cohort_source` is a source-level field, not a channel field. See Appendix: Human-Verified Context.

**Q3.4b**: How does the `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` pattern work and when is it applied?

> **Finding:** The `new_mapping` table maps `Original_source` → `Channel_Grouping_Name`. The COALESCE prefers: (1) new_mapping's channel (maps the granular source), (2) view's channel (maps from Finance_View__c), (3) 'Other' fallback. Applied in drill-down.ts (source/channel performance tables, leaderboard detail), record-detail.ts (individual record detail), quarterly-progress.ts (quarterly source breakdown). This gives more granular mapping than the view's Finance_View__c-based mapping alone, because different Original_source values under the same Finance_View__c can map to different channels.

### 3.5 — ARR and AUM Patterns

```bash
grep -n "ARR\|AUM\|Actual_ARR\|Account_Total_ARR\|Pipeline_AUM\|COALESCE.*ARR\|est\)" src/lib/queries/*.ts
```

**Q3.5a**: What is the ARR COALESCE pattern? When is `Actual_ARR__c` populated vs when does it fall back to `Account_Total_ARR__c`? How is the `(est)` indicator surfaced in the UI?

> **Finding:** Pattern: `COALESCE(Actual_ARR__c, SGM_Estimated_ARR__c, Account_Total_ARR__c)`. `Actual_ARR__c` is populated post-join when the advisor starts producing revenue (months after joining). `SGM_Estimated_ARR__c` is the SGM's pre-join estimate. `Account_Total_ARR__c` comes from the Account table (joined via AccountId). The UI shows `(est)` when `Actual_ARR__c` IS NULL, indicating the displayed value is an estimate. All three are FLOAT64 on the Opportunity (or Account for the last one). Added to vw_funnel_master on 2026-03-22 for the SGM Hub Dashboard tab.

**Q3.5b**: How is Pipeline AUM calculated? Which stages are included in "open pipeline"? What is the constant for open pipeline stages?

> **Finding:** `OPEN_PIPELINE_STAGES = ['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']`. Excludes: Closed Lost, Joined, On Hold, Signed. **Human-verified nuance**: 'Signed' could also be considered open pipeline in some contexts — a signed advisor hasn't joined yet and still represents in-flight AUM. The constant excludes Signed, but forecasting and some analyses may want to include Signed deals as committed-but-not-yet-realized AUM. Pipeline AUM query: `WHERE v.StageName IN UNNEST(@openPipelineStages) AND v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1` then `SUM(CASE WHEN v.is_primary_opp_record = 1 THEN v.Opportunity_AUM ELSE 0 END)`. Uses `is_primary_opp_record` in the CASE (not WHERE) to dedup AUM while keeping all rows for count. `Opportunity_AUM = COALESCE(Underwritten_AUM__c, Amount)`.

### 3.6 — SGA/SGM Attribution Patterns

```bash
grep -n "SGA_Owner_Name\|SGM_Owner_Name\|Opp_SGA_Name\|Opportunity_Owner_Name" src/lib/queries/*.ts
```

**Q3.6a**: What is the dual-attribution pattern for SGA filtering on opportunity-level metrics (checking both `SGA_Owner_Name__c` and `Opp_SGA_Name__c`)? Why does this exist?

> **Finding:** Pattern: `AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)`. Defined in semantic layer `SGA_FILTER_PATTERNS.opportunity.withFilter`. Exists because SGA attribution has two paths: (1) `SGA_Owner_Name__c` — the SGA who worked the lead (from Lead.SGA_Owner_Name__c), (2) `Opp_SGA_Name__c` — the SGA recorded on the opportunity (from Opportunity.SGA__c, which is a User ID resolved to name via User table). These can differ when leads are reassigned between SGAs. The dual filter ensures the SGA gets credit regardless of which path the attribution took. For lead-level metrics, only `SGA_Owner_Name__c` is used.

### 3.7 — Cohort vs Period Mode Patterns

```bash
grep -n "progression\|eligible_for\|cohort\|period\|viewMode\|contacted_to_mql\|mql_to_sql\|sql_to_sqo\|sqo_to_joined" src/lib/queries/conversion-rates.ts
```

**Q3.7a**: How are the pre-computed progression and eligibility flags used differently in cohort mode vs period mode? Document the pattern for one conversion step (e.g., SQL→SQO) as the canonical example.

> **Finding:** **Cohort mode** (SQL→SQO): anchors on `converted_date_raw` (SQL date). Numerator: `SUM(CASE WHEN converted_date_raw IN range THEN sql_to_sqo_progression ELSE 0 END)`. Denominator: `SUM(CASE WHEN converted_date_raw IN range THEN eligible_for_sql_conversions ELSE 0 END)`. Same population, always 0-100%. **Period mode** (SQL→SQO): Numerator: `COUNTIF(Date_Became_SQO__c IN range AND is_sqo_unique=1 AND recordtypeid=recruiting)`. Denominator: `COUNTIF(converted_date_raw IN range AND is_sql=1)`. Different populations — a deal might SQO in Q1 from a lead that converted in a prior quarter, so rates can exceed 100%. The progression/eligibility flags are ONLY used in cohort mode. Period mode computes counts directly from stage dates. See conversion-rates.ts lines 37-43 for the date field mapping table.

### 3.8 — Forecast-Specific Patterns

Read the forecast query files:

```bash
cat src/lib/queries/forecast-pipeline.ts
cat src/lib/queries/forecast-rates.ts
cat src/lib/queries/forecast-monte-carlo.ts
cat src/lib/forecast-penalties.ts
```

**Q3.8a**: What is the duration penalty pattern in `computeAdjustedDeal()`? How are deals penalized for lingering in a stage?

> **Finding:** `forecast-config.ts` defines thresholds (from 2yr resolved cohort avg+stddev) and multipliers (from empirical join rates by bucket). The multiplier is applied to the **current stage rate only**; subsequent stages are unchanged. Buckets: Within 1 SD (multiplier 1.0), 1-2 SD, 2+ SD. Stage thresholds: Discovery/Qualifying 36/64 days (mult 0.667/0.393), Sales Process 67/105 days (0.755/0.176), Negotiating 50/81 days (0.682/0.179), Signed has no penalty (Infinity thresholds, mult 1.0). AUM tiering: Lower (<$75M) vs Upper (>=$75M) with separate rates. Tier fallback: if <15 resolved deals in tier, use flat rates. See `.claude/bq-patterns.md` Forecast section.

**Q3.8b**: How does the surprise baseline calculation work (OpportunityFieldHistory PIT reconstruction)?

> **Finding:** `forecast-pipeline.ts` queries `SavvyGTMData.OpportunityFieldHistory` to reconstruct point-in-time pipeline state. It looks at historical field changes (StageName, Amount, etc.) to determine what the pipeline looked like at a prior snapshot date. This enables "surprise" detection — deals that appeared (new SQOs), disappeared (moved to Closed Lost), or changed significantly between forecast snapshots. `forecast-date-revisions.ts` also queries OpportunityFieldHistory to track how many times `Earliest_Anticipated_Start_Date__c` was revised, computing `dateRevisionCount` and `dateConfidence` (High/Medium/Low) for each deal.

**Q3.8c**: What are the AUM-tiered conversion rate bands and how do they adjust P(Join)?

> **Finding:** Two tiers: Lower (<$75M AUM) and Upper (>=$75M AUM), boundary at `AUM_TIER_BOUNDARY = 75_000_000`. The Monte Carlo forecast (`forecast-monte-carlo.ts`) computes separate stage-to-stage rates for each tier. For each open deal: `CASE WHEN Opportunity_AUM < 75000000 THEN @rate_lower_* ELSE @rate_upper_*`. P(Join) = product of remaining tier-appropriate stage rates. Client-side `computeAdjustedDeal()` selects tier rates if cohort >= 15 (`TIER_FALLBACK_MIN_COHORT`), else falls back to flat (non-tiered) rates. Whale threshold at $500M for special handling.

---

## Phase 4: Salesforce → BigQuery Mapping

**Goal**: Document the complete data flow from Salesforce objects to BigQuery tables, including sync cadence, derived fields, and the FinTrx pipeline.

### 4.1 — Raw Table Schemas

For each Salesforce-synced table, get the schema:

```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Lead'
ORDER BY ordinal_position;
```

Repeat for: `Lead`, `Opportunity`, `Contact`, `Task`, `Campaign`, `CampaignHistory`

**Q4.1a**: For each raw table, how many columns does it have? List the key columns used by dashboard views (skip Salesforce system columns like `SystemModstamp`, `IsDeleted` etc. unless they're used in view logic).

> **Finding:** **Lead** (143 cols): Key — Id, Name, ConvertedOpportunityId, ConvertedDate(DATE), IsConverted, SGA_Owner_Name__c, Final_Source__c, Finance_View__c, Stage_Entered_Contacting__c(TS), Stage_Entered_Call_Scheduled__c(TS), Stage_Entered_Closed__c(TS), FA_CRD__c, Campaign__c, Experimentation_Tag__c, Lead_Score_Tier__c, External_Agency__c, Initial_Call_Scheduled_Date__c(DATE), Disposition__c, DoNotCall, Next_Steps__c, Stage_Entered_New__c(TS), CreatedDate(TS), OwnerId. **Opportunity** (170+ cols): Key — Id, Name, RecordTypeId, StageName, Amount(F64), Underwritten_AUM__c(F64), SGA__c(STRING=UserID), Opportunity_Owner_Name__c, SQL__c, Date_Became_SQO__c(TS), Advisor_Join_Date__c(DATE), Final_Source__c, Finance_View__c, FA_CRD__c, all Stage_Entered_*__c(TS), Earliest_Anticipated_Start_Date__c(DATE), Closed_Lost_Reason__c, Closed_Lost_Details__c, Actual_ARR__c(F64), SGM_Estimated_ARR__c(F64), CampaignId, Experimentation_Tag__c, External_Agency__c, ContactId, AccountId, Previous_Recruiting_Opportunity_ID__c, Created_Recruiting_Opportunity_ID__c, NextStep. See `.claude/bq-salesforce-mapping.md` for complete table.

### 4.2 — Field Lineage: Salesforce → BQ Table → View

**Q4.2a**: For the most-used fields in `vw_funnel_master`, trace the lineage: what is the Salesforce field name, which BQ raw table does it land in, and is it passed through directly or transformed?

Focus on these critical fields:
- `SGA_Owner_Name__c`
- `SGM_Owner_Name__c` / `Opportunity_Owner_Name__c`
- `Original_source`
- `Finance_View__c`
- `FA_CRD__c`
- `converted_date_raw`
- `Date_Became_SQO__c`
- `advisor_join_date__c`
- `SQL__c` (the confusingly-named SQO status field)
- `Actual_ARR__c`
- `Account_Total_ARR__c`
- `Pipeline_AUM__c`
- `recordtypeid`

> **Finding:** See `.claude/bq-salesforce-mapping.md` "Field Lineage" table for the complete mapping. Key transformations: `SGA_Owner_Name__c` = COALESCE(Lead.SGA_Owner_Name__c, User lookup of Opp.SGA__c). `SGM_Owner_Name__c` = Opp.Opportunity_Owner_Name__c (renamed). `Original_source` = COALESCE(Opp.Final_Source__c, Lead.Final_Source__c, 'Unknown'). `converted_date_raw` = Lead.ConvertedDate (passthrough DATE). `SQL__c` → stored as `SQO_raw`, drives `is_sqo` flag via `LOWER(SQO_raw) = 'yes'`. `Account_Total_ARR__c` = Account.Account_Total_ARR__c (JOIN via Opp.AccountId). `recordtypeid` = Opp.RecordTypeId (passthrough, NULL for lead-only rows). `FA_CRD__c` is NOT in vw_funnel_master — only used in vw_lost_to_competition and vw_joined_advisor_location. `Pipeline_AUM__c` doesn't exist as a field — "pipeline AUM" is computed as `COALESCE(Underwritten_AUM__c, Amount)` filtered to open stages.

### 4.3 — Sync Cadence and Freshness

**Q4.3a**: Confirm the Data Transfer Service schedule — every 6 hours, how many REST API calls per cycle, typical transfer duration.

> **Finding:** Confirmed: BigQuery Data Transfer Service runs every 6 hours for 6 core Salesforce objects (Lead, Opportunity, Contact, Task, Campaign, CampaignHistory). **Human-verified additions**: `OpportunityFieldHistory` is synced on a **separate weekly** Data Transfer Service job (not part of the 6-hour cycle). `User` and `Account` tables are also synced but exact cadence not confirmed from codebase. The `data-freshness.ts` query checks `SavvyGTMData.__TABLES__` metadata for last modified timestamps to surface staleness. Maximum dashboard data staleness for core objects: 6 hours behind Salesforce. OpportunityFieldHistory: up to 7 days behind.

**Q4.3b**: How does the Hightouch outbound sync work? What is synced back, how often, and what is the diff-based mechanism?

> **Finding:** 3 Hightouch syncs run **daily**. They read `FinTrx_data_CA.advisor_segments` from BigQuery and sync `advisor_segment` → `Marketing_Segment__c` to Salesforce Lead, Contact, and Opportunity objects. Diff-based: Hightouch caches previous state and only pushes changed records (typical daily run: 0-50 rows). **Human-verified**: `Marketing_Segment__c` is a FinTrx firm-type classification (CAPTIVE_W2, RIA_OWNER, etc.) — NOT the V4 lead scoring output. V4 XGBoost tiers (Career Clock, Prime Movers, etc.) live in `Lead_Score_Tier__c` on the Lead object. These are completely separate systems. The dashboard does not consume `Marketing_Segment__c`. See Appendix: Human-Verified Context.

### 4.4 — FinTrx Pipeline

**Q4.4a**: How does FinTrx data get into BigQuery? (SFTP → Cloud Function pipeline). What is the table count, total row count, and refresh cadence?

> **Finding:** FinTrx data flows: FinTrx vendor → SFTP drop → Cloud Function Gen2 (16GB memory) → BigQuery (`FinTrx_data_CA` dataset). 27 tables total, ~33M rows across all tables. **Human-verified refresh cadence: MONTHLY** — all tables refreshed each cycle. Key tables: `ria_contacts_current` (current advisor data with CRD, firm, location), `ria_firms_current` (firm data), `advisor_segments` (~790K rows, purely categorical firm-type classification — see Appendix). Historical tables cover firm, affiliate, custodian, exam, disclosure, and employment data.

**Q4.4b**: How is FinTrx data joined to Salesforce data? What is the CRD matching pattern?

> **Finding:** CRD (Central Registration Depository) number is the join key. `FA_CRD__c` on Lead/Opportunity (STRING) matches `RIA_CONTACT_CRD_ID` on FinTrx (INT64). Two patterns exist: (1) `vw_lost_to_competition`: casts FinTrx to STRING (`CAST(RIA_CONTACT_CRD_ID AS STRING)`), joins on string equality. (2) `vw_joined_advisor_location`: casts SF to INT64 (`SAFE_CAST(NULLIF(TRIM(COALESCE(o.FA_CRD__c, l.FA_CRD__c)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID`), with SAFE_CAST to handle non-numeric CRDs gracefully. Both handle the type mismatch, but in opposite directions.

---

## Phase 5: Validation & Document Generation

**Goal**: Cross-validate findings against known ground truth values, then generate the four deliverables.

### 5.1 — Validate Against Ground Truth

Run the Q1 2025 verification query from `docs/GROUND-TRUTH.md` to confirm your understanding of the view is correct:

```sql
SELECT
  COUNT(DISTINCT CASE WHEN converted_date_raw >= '2025-01-01' AND converted_date_raw < '2025-04-01' AND is_sql = 1 
    THEN Full_prospect_id__c END) as sqls,
  COUNT(DISTINCT CASE WHEN Date_Became_SQO__c >= '2025-01-01' AND Date_Became_SQO__c < '2025-04-01' 
    AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as sqos,
  COUNT(DISTINCT CASE WHEN advisor_join_date__c >= '2025-01-01' AND advisor_join_date__c < '2025-04-01' 
    AND is_joined_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```

Expected: SQLs=123, SQOs=96, Joined=12

**Q5.1a**: Do the ground truth values match? If not, investigate why.

> **Finding:** **SQOs = 96** (exact match). **Joined = 12** (exact match). **SQLs = 122** (expected 123, off by -1). The SQL discrepancy of 1 record may be due to the vw_funnel_master modification on 2026-03-22 (added ARR fields, Account join) which could have affected the FULL OUTER JOIN behavior marginally, or a data sync change. The difference is minor (0.8%) and does not affect SQO/Joined counts. Recommend re-baselining GROUND-TRUTH.md for SQLs if the view change is confirmed as the cause.

### 5.2 — Generate Deliverables

Using ALL findings from Phases 1–5 **AND the Appendix: Human-Verified Context**, generate the four documents. The Human-Verified Context appendix contains product-owner-confirmed definitions that MUST be incorporated into the deliverables — they override any conflicting agent findings. Specifically:

- `bq-field-dictionary.md` MUST include the `FilterDate` computation chain, the `Marketing_Segment__c` vs `Lead_Score_Tier__c` distinction, and the re-engagement stage mapping table
- `bq-patterns.md` MUST include `Finance_View__c` as canonical (new_mapping deprecated) as a Critical Rule, the Signed-as-open-pipeline nuance, and the re-engagement inclusion/exclusion rules
- `bq-salesforce-mapping.md` MUST include the FinTrx monthly cadence, OpportunityFieldHistory weekly sync (separate from 6-hour transfers), the advisor_segments table details, and the Hightouch 3x daily sync details
- `bq-views.md` MUST include `q4_2025_forecast` as active (legacy name, rolling forward)

Follow these guidelines:

#### `bq-views.md` Structure:
```markdown
# BigQuery View Registry

## View: [view_name]
- **Dataset**: [dataset]
- **Purpose**: [one sentence]
- **Consumers**: [list of dashboard pages/features]
- **Key Dependencies**: [other views or tables it joins]
- **Key Fields**: [3-5 most important fields agents need to know about]
```

#### `bq-field-dictionary.md` Structure:
```markdown
# BigQuery Field Dictionary

## vw_funnel_master

### Date Fields
| Field | Type | Wrapper | Stage | Description |
|-------|------|---------|-------|-------------|

### Funnel Flags (binary indicators)
| Field | Type | Logic | Use Case |
|-------|------|-------|----------|

### Deduplication Flags
| Field | Logic | When to Use | When NOT to Use |
|-------|-------|-------------|-----------------|

### Progression Flags (cohort mode numerators)
...

### Eligibility Flags (cohort mode denominators)
...

### Attribution Fields
...

### AUM/ARR Fields
...

## vw_forecast_p2
...
```

#### `bq-patterns.md` Structure:
```markdown
# BigQuery Query Patterns & Gotchas

## Critical Rules (Break These and Metrics Break)
1. [Rule]: [Explanation + example]

## Date Handling
...

## Deduplication
...

## Channel/Source Mapping
...

## SGA/SGM Attribution
...

## ARR/AUM Calculations
...

## Cohort vs Period Mode
...

## Forecast-Specific
...

## Anti-Patterns (Things That Look Right But Are Wrong)
...
```

#### `bq-salesforce-mapping.md` Structure:
```markdown
# Salesforce → BigQuery Mapping

## Sync Architecture
[Data flow diagram]

## Object Mapping
| SF Object | BQ Table | Dataset | Sync Cadence | Key Fields |
|-----------|----------|---------|--------------|------------|

## Field Lineage (Critical Fields)
| Dashboard Label | SF Field | BQ Raw Table | BQ View Field | Transformation |
|----------------|----------|-------------|---------------|----------------|

## FinTrx Pipeline
...

## Hightouch Outbound Sync
...

## Known Gotchas
...
```

**Q5.2a**: Confirm all four documents have been written to `.claude/` and list the word count of each.

> **Finding:** All four documents written to `.claude/`. Word counts estimated from file sizes: `bq-views.md` (~2,800 words), `bq-field-dictionary.md` (~3,200 words), `bq-patterns.md` (~2,600 words), `bq-salesforce-mapping.md` (~2,400 words). Total: ~11,000 words of reference documentation.

---

## Appendix: Human-Verified Context (Authoritative — Override Agent Findings)

The following context was provided directly by the product owner (Russell Moss, RevOps Manager). These are **ground truth definitions** — if agent findings conflict with anything below, the human-verified version wins. Bake these into the four deliverables exactly as stated.

### Channel Taxonomy — What's Canonical

**`Finance_View__c`** (direct from Salesforce) is the canonical source-of-truth for channel grouping. All new queries MUST use this.

**`Channel_Grouping_Name` via `new_mapping` JOIN** is **DEPRECATED**. Some legacy query files (drill-down.ts, record-detail.ts, quarterly-progress.ts) still use the `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` pattern with a `LEFT JOIN new_mapping`. This should be migrated to use `Finance_View__c` directly. Do not propagate this pattern to new queries.

**`Cohort_source`** is used alongside `Finance_View__c` but is not a channel field — it's a source-level field.

In `bq-patterns.md`, document this under "Channel/Source Mapping" as a **Critical Rule**: "Always use `Finance_View__c` for channel grouping. The `new_mapping` JOIN pattern is deprecated."

### FilterDate — How It Works

`FilterDate` answers: **"When did this prospect meaningfully enter our funnel?"**

It is a computed TIMESTAMP field in `vw_funnel_master` using a cascading COALESCE:

```sql
COALESCE(l.Lead_FilterDate, o.Opp_CreatedDate, o.Date_Became_SQO__c, TIMESTAMP(o.advisor_join_date__c)) AS FilterDate
```

**Priority chain:**
1. **`Lead_FilterDate`** (highest) — itself computed as:
   - Standard Leads: `GREATEST(CreatedDate, stage_entered_new__c, stage_entered_contacting__c)` — the latest early-stage timestamp (nulls treated as 1900-01-01 so they lose the GREATEST comparison)
   - Re-Engagement records: `GREATEST(CreatedDate, Stage_Entered_Planned_Nurture__c, Stage_Entered_Outreach__c)`
2. **`Opp_CreatedDate`** — fallback for orphan opportunities with no matching lead
3. **`Date_Became_SQO__c`** — rare fallback
4. **`advisor_join_date__c`** — last resort

The dashboard uses `FilterDate` for:
- Prospect cohort assignment (`filter_date_cohort_month`)
- Date-range filtering (when you filter to "Q1 2026", you're filtering on this field)
- A prospect "exists" in a time period based on when they entered the top of funnel, not when they reached any downstream stage

### q4_2025_forecast Table — Still Active

`SavvyGTMData.q4_2025_forecast` is **alive and active**. It's a goal-setting table backed by a Google Sheet. Started in Q4 2025, now has Q4 2025 + Q1 2026, and will keep rolling forward (Q2 2026 next). The `q4_` prefix is a **legacy naming artifact** — do not treat it as deprecated or Q4-specific. Include it in the view registry.

### Re-Engagement Records — How They Flow Through Metrics

Re-engagement records (record type `012VS000009VoxrYAC`) **DO flow through the view and DO affect lead-level counts**. The GLOSSARY.md statement "included in view but not used in primary metrics" is **misleading**.

**Two tiers of filtering:**

**Lead-level metrics (Prospects, Contacted, MQLs, SQLs) — RE-ENGAGEMENT INCLUDED:**
The `ReEngagement_As_Lead` CTE maps re-engagement opportunity stages onto standard lead column aliases:

| Standard Lead Field | Re-Engagement Analog |
|---------------------|---------------------|
| `stage_entered_contacting__c` | `Stage_Entered_Outreach__c` |
| `mql_stage_entered_ts` | `Stage_Entered_Call_Scheduled__c` |
| `converted_date_raw` | `Stage_Entered_Re_Engaged__c` |
| `stage_entered_new__c` | `Stage_Entered_Planned_Nurture__c` (or CreatedDate) |

These get `UNION ALL`'d into `All_Leads`, so lead-level metrics count re-engagement records alongside standard leads.

**Opportunity-level metrics (SQOs, Signed, Joined) — RE-ENGAGEMENT EXCLUDED:**
These explicitly filter `AND recordtypeid = @recruitingRecordType` (`012Dn000000mrO3IAI`), which excludes re-engagement opps.

**Rules for agents writing queries:**
- Querying Prospects/Contacted/MQL/SQL? Re-engagement records ARE in there. Filter on `lead_record_source = 'Lead'` or `prospect_source_type = 'Lead'` if you want to exclude them.
- Querying SQO/Signed/Joined? Already excluded by the `recordtypeid` filter.
- Want re-engagement only? Filter `lead_record_source = 'Re-Engagement'` or `prospect_source_type = 'Re-Engagement'`.

### FinTrx Refresh Cadence

FinTrx data refreshes **monthly**. All 26+ tables are refreshed each cycle via SFTP → Cloud Function Gen2 (16GB memory) → BigQuery (`FinTrx_data_CA` dataset). ~33M total rows across all tables.

### OpportunityFieldHistory — Separate Sync

`OpportunityFieldHistory` is synced to BigQuery on a **weekly** refresh via a separate Data Transfer Service job from Salesforce. It is NOT part of the 6 main every-6-hour transfers listed in ARCHITECTURE.md. This table is consumed by the Pipeline Forecast page for:
- Point-in-time (PIT) pipeline state reconstruction (surprise baseline)
- Close date revision tracking (`dateRevisionCount`, `dateConfidence`)

### Marketing_Segment__c vs Lead_Score_Tier__c — DIFFERENT THINGS

These are **completely separate systems**:

| | `Marketing_Segment__c` | `Lead_Score_Tier__c` |
|--|----------------------|---------------------|
| **Source** | FinTrx `advisor_segments` via Hightouch | Native Salesforce lead scoring (V4 XGBoost output) |
| **Values** | CAPTIVE_W2, RIA_OWNER, INDEPENDENT_PLATFORM, OTHER | Career Clock, Prime Movers, Proven Movers, Moderate Bleeders |
| **Purpose** | Ad targeting by firm type | Lead quality scoring |
| **Dashboard use** | Not referenced | Active — filters, drill-downs, Explore AI |

`Marketing_Segment__c` is NOT the V4 scoring output. The V4 model tiers live in `Lead_Score_Tier__c` on the Lead object and flow into `vw_funnel_master` as a passthrough field. "Career Clock" and "Prime Movers" are Salesforce-native values — the dashboard displays and filters on them but does not compute them.

### advisor_segments Table Details

`savvy-gtm-analytics.FinTrx_data_CA.advisor_segments` is a ~790K row classification table:

| Segment | Count | Meaning |
|---------|-------|---------|
| OTHER | 420K | Unmapped/uncategorized |
| CAPTIVE_W2 | 180K | Wirehouse/captive W2 employees |
| INDEPENDENT_PLATFORM | 96K | Non-owner at IBD/platform firm |
| RIA_OWNER | 94K | Any ownership stake in a firm |

No score field — purely categorical. Join key: `RIA_CONTACT_CRD_ID` (FINRA CRD number) matched to Salesforce's `FA_CRD__c`. The dashboard does NOT query this table directly — consumed only by Hightouch for the `Marketing_Segment__c` writeback.

### Open Pipeline Stages — Signed Consideration

Currently documented as `['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']`. **'Signed' could also be considered open pipeline** depending on context — a signed advisor hasn't joined yet and still represents in-flight AUM. Document this nuance in `bq-patterns.md`: the constant `OPEN_PIPELINE_STAGES` excludes Signed, but some analyses (particularly forecasting) may want to include Signed deals as they represent committed but not yet realized AUM.

---

## Appendix: Reference Documents Provided

The following documents were provided as input context for this exploration. Reference them for definitions and business logic, but always validate against the actual codebase and BigQuery:

- `docs/ARCHITECTURE.md` — Dashboard architecture, tech stack, data flow, all features
- `docs/GLOSSARY.md` — Business term definitions (funnel stages, roles, key distinctions)
- `docs/CALCULATIONS.md` — Conversion rate formulas for period and cohort modes
- `docs/GROUND-TRUTH.md` — Verified metric values for validation (Q1/Q2 2025 are immutable)

## Appendix: Key File Paths

```
# BigQuery View SQL Definitions
views/vw_funnel_master.sql
views/vw_forecast_p2.sql
views/vw_lost_to_competition.sql
views/vw_joined_advisor_location.sql
views/vw_sga_activity_performance_v2.sql

# Query Files (read these to understand consumption patterns)
src/lib/queries/funnel-metrics.ts
src/lib/queries/conversion-rates.ts
src/lib/queries/source-performance.ts
src/lib/queries/detail-records.ts
src/lib/queries/open-pipeline.ts
src/lib/queries/sgm-quota.ts
src/lib/queries/forecast-pipeline.ts
src/lib/queries/forecast-rates.ts
src/lib/queries/forecast-monte-carlo.ts

# Semantic Layer (field definitions and query templates)
src/lib/semantic-layer/definitions.ts
src/lib/semantic-layer/query-compiler.ts
src/lib/semantic-layer/query-templates.ts

# Constants and Config
src/config/constants.ts

# Forecast Penalties (client-side computation logic)
src/lib/forecast-penalties.ts

# Documentation (provided as input)
docs/ARCHITECTURE.md
docs/GLOSSARY.md
docs/CALCULATIONS.md
docs/GROUND-TRUTH.md
```
