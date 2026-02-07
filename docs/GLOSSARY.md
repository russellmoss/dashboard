# Business Glossary

This document defines business terms and concepts used in the Savvy Funnel Analytics Dashboard. These definitions are critical for understanding how metrics are calculated and what they represent.

## Funnel Stages

### Prospect
- **Definition**: A record that entered the funnel (new or recycled) based on FilterDate
- **Trigger**: `FilterDate` is set and within the selected date range
- **Business Context**: All records that are part of the funnel, regardless of stage
- **Date Field**: `FilterDate` (used for period grouping)
- **Note**: This is the broadest stage - includes all records in the funnel

### Contacted
- **Definition**: A lead that has been reached out to by the sales team (SGA) and has been contacted
- **Trigger**: `stage_entered_contacting__c` timestamp is set AND `is_contacted = 1`
- **Owner**: SGA (Sales Growth Advisor) via `SGA_Owner_Name__c` on Lead
- **Business Context**: First meaningful engagement with a prospect
- **Date Field**: `stage_entered_contacting__c` (used for both period and cohort grouping)
- **Filter Condition**: Must have `is_contacted = 1` flag set

### MQL (Marketing Qualified Lead)
- **Definition**: A contacted lead that has scheduled a call (shows buying intent)
- **Trigger**: `mql_stage_entered_ts` timestamp is set (Call Scheduled stage)
- **Owner**: SGA (Sales Growth Advisor) via `SGA_Owner_Name__c` on Lead
- **NOT the same as**: Salesforce's standard MQL definition
- **Business Context**: Lead has shown enough interest to schedule a call
- **Date Field**: `mql_stage_entered_ts` (used for both period and cohort grouping)

### SQL (Sales Qualified Lead)
- **Definition**: A lead that has been CONVERTED to an Opportunity in Salesforce
- **Trigger**: `IsConverted = TRUE` and `converted_date_raw` is set
- **Owner**: SGA (Sales Growth Advisor) via `SGA_Owner_Name__c` on Lead (pre-conversion)
- **Note**: This is the Salesforce Lead → Opportunity conversion, not a custom stage
- **Business Context**: Lead has been qualified and converted to an opportunity
- **Date Field**: `converted_date_raw` (used for both period and cohort grouping)

### SQO (Sales Qualified Opportunity)
- **Definition**: An opportunity that has been vetted and confirmed as a real prospect
- **Trigger**: `SQL__c = 'Yes'` (confusingly named field in Salesforce - actually means SQO status)
- **Record Type**: Must be Recruiting (`012Dn000000mrO3IAI`)
- **Owner**: SGM (Sales Growth Manager) via `SGM_Owner_Name__c` on Opportunity
- **Dedup Field**: Use `is_sqo_unique = 1` for volume counts (ensures one count per opportunity)
- **Business Context**: Opportunity has passed qualification and is actively being worked
- **Date Field**: `Date_Became_SQO__c` (used for both period and cohort grouping)
- **Important**: The field `SQL__c` in Salesforce actually represents SQO status, not SQL status

### Joined
- **Definition**: An advisor who has signed and joined Savvy
- **Trigger**: `advisor_join_date__c` is set OR `StageName = 'Joined'`
- **Record Type**: Must be Recruiting (`012Dn000000mrO3IAI`)
- **Owner**: SGM (Sales Growth Manager) via `SGM_Owner_Name__c` on Opportunity
- **Dedup Field**: Use `is_joined_unique = 1` for volume counts (ensures one count per opportunity)
- **Business Context**: Final stage - advisor has completed onboarding
- **Date Field**: `advisor_join_date__c` (used for both period and cohort grouping)

## Opportunity Stages

After a lead converts to an opportunity (SQL), the opportunity progresses through various stages. These stages are tracked via `StageName` and have associated `Stage_Entered_*` timestamp fields that record when the opportunity entered each stage.

### Stage Order and Date Fields

| Stage Name | Date Field | Data Type | Description | Filtering Logic |
|------------|------------|-----------|-------------|-----------------|
| **Qualifying** | None (uses `StageName`) | N/A | Initial opportunity qualification stage | Filter by `StageName = 'Qualifying'` (no date filter) |
| **Discovery** | `Stage_Entered_Discovery__c` | TIMESTAMP | Opportunity entered discovery phase | Filter by `Stage_Entered_Discovery__c` in date range |
| **Sales Process** | `Stage_Entered_Sales_Process__c` | TIMESTAMP | Opportunity entered active sales process | Filter by `Stage_Entered_Sales_Process__c` in date range |
| **Negotiating** | `Stage_Entered_Negotiating__c` | TIMESTAMP | Opportunity entered negotiation phase | Filter by `Stage_Entered_Negotiating__c` in date range |
| **Signed** | `Stage_Entered_Signed__c` | TIMESTAMP | Opportunity signed agreement | Filter by `Stage_Entered_Signed__c` in date range, use `is_primary_opp_record = 1` for deduplication |
| **On Hold** | `Stage_Entered_On_Hold__c` | TIMESTAMP | Opportunity placed on hold | Filter by `Stage_Entered_On_Hold__c` in date range |
| **Closed Lost** | `Stage_Entered_Closed__c` | TIMESTAMP | Opportunity closed without joining | Filter by `Stage_Entered_Closed__c` in date range AND `StageName = 'Closed Lost'` |
| **Joined** | `advisor_join_date__c` | DATE | Advisor officially joined (final stage) | Filter by `advisor_join_date__c` in date range, use `is_joined_unique = 1` for deduplication |

### Important Notes

1. **Date Type Handling**:
   - **TIMESTAMP fields** (`Stage_Entered_*`): Use `TIMESTAMP(field) >= TIMESTAMP(@startDate)` in queries
   - **DATE fields** (`advisor_join_date__c`): Use `DATE(field) >= DATE(@startDate)` in queries

2. **Deduplication**:
   - **Signed**: Use `is_primary_opp_record = 1` to ensure one count per opportunity (handles multiple leads converting to same opportunity)
   - **Joined**: Use `is_joined_unique = 1` for volume counts
   - **Other stages**: Filtering by date field automatically handles deduplication when combined with `is_primary_opp_record = 1`

3. **Filtering Logic**:
   - Stages with date fields (Discovery, Sales Process, Negotiating, Signed, On Hold, Closed Lost): Filter by their `Stage_Entered_*` date being in the selected date range, regardless of current `StageName`
   - Stages without date fields (Qualifying): Filter by `StageName` matching the stage name

4. **Stage Progression**:
   - Opportunities can move forward through stages (e.g., Discovery → Sales Process → Negotiating → Signed → Joined)
   - Opportunities can also move backward or skip stages
   - When filtering by a stage's date, records that have moved past that stage are still included if they entered that stage in the date range

5. **Record Detail Table Display**:
   - The date column dynamically shows the stage-specific date based on the selected stage filter
   - For example, when "Signed" is selected, the date column shows `Stage_Entered_Signed__c`
   - When "Discovery" is selected, the date column shows `Stage_Entered_Discovery__c`

## Roles

### SGA (Sales Growth Advisor)
- **Role**: Top-of-funnel lead qualifier
- **Owns**: Lead records, initial outreach, qualification
- **Lead Field**: `SGA_Owner_Name__c` on Lead object
- **Opportunity Field**: `Opp_SGA_Name__c` on Opportunity object (SGA associated with opp)
- **Filters Applied**: `SGA_Owner_Name__c` for lead metrics, `Opp_SGA_Name__c` for opportunity metrics

### SGM (Sales Growth Manager)
- **Role**: Manages opportunities through close
- **Owns**: Opportunity records post-conversion
- **Field**: `SGM_Owner_Name__c` (from `Opportunity_Owner_Name__c` on Opportunity)
- **Filters Applied**: `SGM_Owner_Name__c` for opportunity-level metrics (SQO, Joined, AUM)

## Key Distinctions

| Term | What it IS | What it is NOT |
|------|------------|----------------|
| **SQL** | Lead converted to Opportunity | Lead quality score |
| **SQO** | Opportunity passed qualification | Same as SQL |
| **`SQL__c` field** | SQO status (yes/no) | SQL indicator |
| **Period Mode** | Activity-based tracking | Cohort-based tracking |
| **Cohort Mode** | Resolved-only efficiency tracking | Activity-based tracking |
| **`is_sqo`** | Binary flag (0/1) for any record | Deduplicated count |
| **`is_sqo_unique`** | Deduplicated count (1 per opp) | Binary flag for all records |

## Data Source

All metrics are calculated from the `vw_funnel_master` view:
- **Full Table Path**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- **Purpose**: Single source of truth combining Lead and Opportunity data
- **Deduplication**: Handles multiple leads converting to same opportunity
- **Pre-calculated Flags**: Includes eligibility and progression flags for cohort mode

## Record Types

### Recruiting (`012Dn000000mrO3IAI`)
- **Use Case**: Primary opportunity type for new advisor recruitment
- **Required For**: SQO and Joined calculations
- **Filter**: Always include `recordtypeid = '012Dn000000mrO3IAI'` for SQO/Joined metrics

### Re-Engagement (`012VS000009VoxrYAC`)
- **Use Case**: Re-engaging existing advisors
- **Note**: Currently included in view but not used in primary metrics

## Attribution Fields

### Lead Attribution
- **SGA**: `SGA_Owner_Name__c` (from Lead object)
- **Source**: `Original_source` (from Lead or Opportunity)
- **Channel**: `Channel_Grouping_Name` (from `new_mapping` table)

### Opportunity Attribution
- **SGA**: `Opp_SGA_Name__c` (from Opportunity object)
- **SGM**: `SGM_Owner_Name__c` (from `Opportunity_Owner_Name__c`)
- **Source**: `Original_source` (from Opportunity or Lead)
- **Channel**: `Channel_Grouping_Name` (from `new_mapping` table)

## Common Confusions

1. **SQL vs SQO**: 
   - SQL = Lead converted to Opportunity (`converted_date_raw`)
   - SQO = Opportunity qualified (`SQL__c = 'Yes'`, despite confusing field name)

2. **`SQL__c` Field Name**:
   - Despite being named `SQL__c`, this field actually represents SQO status
   - This is a legacy naming issue from Salesforce
   - Always check the value, not the field name

3. **Deduplication**:
   - Multiple leads can convert to the same opportunity
   - Always use `is_sqo_unique` and `is_joined_unique` for volume counts
   - Use `is_sqo` and `is_joined` for rate calculations (progression flags)

4. **Date Fields**:
   - Each stage has a specific date field for grouping
   - Period and cohort modes use the same date fields for grouping
   - Numerators and denominators may use different date fields in period mode

5. **Contacted→MQL denominator (30-day rule)**:
   - The dashboard uses `eligible_for_contacted_conversions_30d` for the Contacted→MQL conversion rate denominator.
   - Leads in Contacting for 30+ days without MQL or close are treated as resolved in the denominator (reporting only; no Salesforce change). See `docs/CALCULATIONS.md` and `cursor-implement-30day-rule.md`.

---

## View Modes

### Focused View
- **Definition**: Executive view showing SQL, SQO, and Joined metrics only
- **Purpose**: Provides a streamlined view for executive-level reporting
- **Metrics Shown**: SQLs, SQOs, Joined, and their associated conversion rates
- **Use Case**: High-level performance tracking and executive dashboards

### Full Funnel View
- **Definition**: Complete funnel view including all stages from Prospect to Joined
- **Purpose**: Provides comprehensive visibility into the entire funnel
- **Metrics Shown**: Prospects, Contacted, MQLs, SQLs, SQOs, Joined, and all conversion rates
- **Use Case**: Detailed analysis, funnel optimization, and marketing performance tracking
- **Additional Features**: 
  - Extended table columns showing top-of-funnel metrics
  - MQLs/goal tracking in Channel and Source Performance tables
  - Contacted and MQL badges in Detail Records table
