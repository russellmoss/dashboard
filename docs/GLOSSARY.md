# Business Glossary

This document defines business terms and concepts used in the Savvy Funnel Analytics Dashboard. These definitions are critical for understanding how metrics are calculated and what they represent.

## Funnel Stages

### Contacted
- **Definition**: A lead that has been reached out to by the sales team (SGA)
- **Trigger**: `stage_entered_contacting__c` timestamp is set
- **Owner**: SGA (Sales Growth Advisor) via `SGA_Owner_Name__c` on Lead
- **Business Context**: First meaningful engagement with a prospect
- **Date Field**: `stage_entered_contacting__c` (used for both period and cohort grouping)

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
