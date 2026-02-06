WITH Lead_Base AS (
  SELECT
    Id AS Full_prospect_id__c,
    Name AS Prospect_Name,
    ConvertedOpportunityId AS converted_oppty_id,
    CreatedDate,
    OwnerId AS Lead_OwnerId,
    Final_Source__c AS Lead_Original_Source,  -- Using Final_Source__c instead of LeadSource
    Final_Source__c AS Final_Source,
    Finance_View__c AS Lead_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
    stage_entered_contacting__c,
    Stage_Entered_Call_Scheduled__c AS mql_stage_entered_ts,
    ConvertedDate AS converted_date_raw,
    IsConverted,
    Disposition__c,
    DoNotCall,
    stage_entered_new__c,
    Experimentation_Tag__c AS Lead_Experimentation_Tag__c,
    Campaign__c AS Lead_Campaign_Id__c,
    Lead_Score_Tier__c,
    External_Agency__c AS Lead_External_Agency__c,
    SGA_Owner_Name__c AS Lead_SGA_Owner_Name__c,  -- SGA who owns/worked this lead
    Next_Steps__c AS Lead_Next_Steps__c,
    Initial_Call_Scheduled_Date__c,
    Stage_Entered_Closed__c AS lead_closed_date,  -- WHEN the lead was closed (timestamp for period-resolved)
    --##TODO## Talk to Kenji on how we get campaigns in here (if we want) or if we should bring in UTM Parameters

    -- FilterDate: Handles recycled leads by taking the most recent of creation or stage entry
    GREATEST(
      IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
      IFNULL(stage_entered_new__c, TIMESTAMP('1900-01-01')),
      IFNULL(stage_entered_contacting__c, TIMESTAMP('1900-01-01'))
    ) AS Lead_FilterDate
    
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
),

Opp_Base AS (
  SELECT
    Id AS Full_Opportunity_ID__c,
    Name AS Opp_Name,
    OwnerId AS Opp_OwnerId,
    Final_Source__c AS Opp_Original_Source,  -- Using Final_Source__c instead of LeadSource
    Finance_View__c AS Opp_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
    SGA__c AS Opp_SGA_Name,                        -- SGA name associated with this opportunity
    Opportunity_Owner_Name__c AS Opp_SGM_Name,    -- SGM who owns this opportunity
    SQL__c AS SQO_raw,  -- NOTE: This field represents SQO status despite the name
    Date_Became_SQO__c,
    Earliest_Anticipated_Start_Date__c,
    advisor_join_date__c,
    StageName,
    Amount,
    Underwritten_AUM__c,
    RecordTypeId,
    CreatedDate AS Opp_CreatedDate,
    Closed_Lost_Reason__c,
    Closed_Lost_Details__c,
    Stage_Entered_Discovery__c,
    Stage_Entered_Sales_Process__c,
    Stage_Entered_Negotiating__c,
    Stage_Entered_Signed__c,
    Stage_Entered_On_Hold__c,
    Stage_Entered_Closed__c,
    Qualification_Call_Date__c,
    Experimentation_Tag__c AS Opportunity_Experimentation_Tag__c,
    External_Agency__c AS Opp_External_Agency__c,
    CampaignId AS Opp_Campaign_Id__c,
    NextStep AS Opp_NextStep

  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
),

-- Join leads and opportunities
Combined AS (
  SELECT
    -- Primary Keys & Identifiers
    COALESCE(l.Full_prospect_id__c, o.Full_Opportunity_ID__c) AS primary_key,
    l.Full_prospect_id__c,
    o.Full_Opportunity_ID__c,
    COALESCE(o.Opp_Name, l.Prospect_Name) AS advisor_name,
    
    -- Deduplication: Identify primary row per opportunity (first lead by CreatedDate)
    -- This ensures opportunity-level metrics (SQO, Joined) count once per opportunity
    ROW_NUMBER() OVER (
      PARTITION BY o.Full_Opportunity_ID__c 
      ORDER BY l.CreatedDate ASC NULLS LAST
    ) AS opp_row_num,
    
    -- Salesforce URLs for drilldown
    CASE 
      WHEN l.Full_prospect_id__c IS NOT NULL 
      THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', l.Full_prospect_id__c, '/view')
      ELSE NULL
    END AS lead_url,
    CASE 
      WHEN o.Full_Opportunity_ID__c IS NOT NULL 
      THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', o.Full_Opportunity_ID__c, '/view')
      ELSE NULL
    END AS opportunity_url,
    CASE 
      WHEN o.Full_Opportunity_ID__c IS NOT NULL 
      THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', o.Full_Opportunity_ID__c, '/view')
      ELSE CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', l.Full_prospect_id__c, '/view')
    END AS salesforce_url,
    
    -- Attribution
    -- Using Final_Source__c from both Lead and Opportunity
    COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,
    -- Using Finance_View__c from both Lead and Opportunity for channel mapping (prefer Opportunity over Lead, default to 'Other')
    COALESCE(o.Opp_Finance_View__c, l.Lead_Finance_View__c, 'Other') AS Finance_View__c,
    COALESCE(o.Opp_External_Agency__c, l.Lead_External_Agency__c) AS External_Agency__c,
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- SGA/SGM ATTRIBUTION (Simplified - direct name fields, no User lookup)
    -- ═══════════════════════════════════════════════════════════════════════
    l.Lead_SGA_Owner_Name__c AS SGA_Owner_Name__c,  -- SGA who owns/worked the lead
    o.Opp_SGA_Name AS Opp_SGA_Name__c,              -- SGA associated with the opportunity
    o.Opp_SGM_Name AS SGM_Owner_Name__c,            -- SGM who owns the opportunity
    l.Lead_Next_Steps__c AS Next_Steps__c,
    o.Opp_NextStep AS NextStep,

    -- Dates
    COALESCE(l.Lead_FilterDate, o.Opp_CreatedDate, o.Date_Became_SQO__c, TIMESTAMP(o.advisor_join_date__c)) AS FilterDate,
    l.CreatedDate,
    l.stage_entered_contacting__c,
    l.mql_stage_entered_ts,
    l.converted_date_raw,
    l.Initial_Call_Scheduled_Date__c,
    o.Opp_CreatedDate,
    o.Date_Became_SQO__c,
    o.advisor_join_date__c,
    o.Qualification_Call_Date__c,
    o.Stage_Entered_Signed__c,
    o.Stage_Entered_Discovery__c,
    o.Stage_Entered_Sales_Process__c,
    o.Stage_Entered_Negotiating__c,
    o.Stage_Entered_On_Hold__c,
    o.Stage_Entered_Closed__c,
    l.lead_closed_date,
    
    -- Funnel Flags (Binary 0/1)
    CASE WHEN l.stage_entered_contacting__c IS NOT NULL THEN 1 ELSE 0 END AS is_contacted,
    CASE WHEN l.mql_stage_entered_ts IS NOT NULL THEN 1 ELSE 0 END AS is_mql,
    CASE WHEN l.IsConverted IS TRUE THEN 1 ELSE 0 END AS is_sql,
    CASE WHEN LOWER(o.SQO_raw) = 'yes' THEN 1 ELSE 0 END AS is_sqo,
    CASE WHEN o.advisor_join_date__c IS NOT NULL OR o.StageName = 'Joined' THEN 1 ELSE 0 END AS is_joined,
    
    -- Stage Info
    o.StageName,
    o.SQO_raw,
    l.Disposition__c,
    l.DoNotCall,
    o.Closed_Lost_Reason__c,
    o.Closed_Lost_Details__c,
    
    -- AUM
    COALESCE(o.Underwritten_AUM__c, o.Amount) AS Opportunity_AUM,
    o.Underwritten_AUM__c,
    o.Amount,
    
    -- Experiment Tags (raw)
    COALESCE(o.Opportunity_Experimentation_Tag__c, l.Lead_Experimentation_Tag__c) AS Experimentation_Tag_Raw__c,
    
    -- Campaign IDs (raw and coalesced)
    COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c,
    l.Lead_Campaign_Id__c,
    o.Opp_Campaign_Id__c,
    
    -- Record Classification
    o.RecordTypeId AS recordtypeid,
    l.Lead_Score_Tier__c
    
  FROM Lead_Base l
  FULL OUTER JOIN Opp_Base o
    ON l.converted_oppty_id = o.Full_Opportunity_ID__c
    --##TODO## In the future we may need to create a view of re-engagement opportunities and have them look like
    -- 'leads' where they 'convert' into Recruiting Type Opportunities.
),

-- Add Channel Mapping (using Finance_View__c directly from Salesforce records)
With_Channel_Mapping AS (
  SELECT
    c.*,
    -- Use Finance_View__c directly from Combined CTE (which comes from Lead/Opp records)
    -- Keep field name as Channel_Grouping_Name for backward compatibility
    IFNULL(c.Finance_View__c, 'Other') AS Channel_Grouping_Name
  FROM Combined c
),

-- Add User lookup for Opportunity SGA names (when SGA_Owner_Name__c is NULL)
With_SGA_Lookup AS (
  SELECT
    wcm.*,
    u.Name AS Opp_SGA_User_Name
  FROM With_Channel_Mapping wcm
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
    ON wcm.Opp_SGA_Name__c = u.Id
),

-- Join Campaign table to get campaign names for display
With_Campaign_Name AS (
  SELECT
    wsl.*,
    c.Name AS Campaign_Name__c
  FROM With_SGA_Lookup wsl
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
    ON wsl.Campaign_Id__c = c.Id
),

-- Final transformation with all derived fields
Final AS (
  SELECT
    wsl.* EXCEPT(SGA_Owner_Name__c),
    -- Override SGA_Owner_Name__c to use Opp_SGA_User_Name when Lead SGA is NULL
    -- This handles opportunities created directly (not from leads)
    COALESCE(wsl.SGA_Owner_Name__c, wsl.Opp_SGA_User_Name) AS SGA_Owner_Name__c,
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- OPPORTUNITY DEDUPLICATION FLAGS
    -- Ensures opportunity-level metrics (SQO, Joined, AUM) count once per opportunity
    -- even when multiple leads convert to the same opportunity
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Flag: Is this the primary row for this opportunity?
    -- TRUE for: first lead per opportunity, OR opportunity-only records
    CASE 
      WHEN Full_Opportunity_ID__c IS NULL THEN 1  -- Lead-only records
      WHEN opp_row_num = 1 THEN 1                  -- First lead for this opp
      ELSE 0 
    END AS is_primary_opp_record,
    
    -- SQO count field (use this instead of is_sqo for volume counts)
    -- Only counts once per opportunity, even if multiple leads converted
    CASE 
      WHEN LOWER(SQO_raw) = 'yes' 
        AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
      THEN 1 
      ELSE 0 
    END AS is_sqo_unique,
    
    -- Joined count field (use this instead of is_joined for volume counts)
    -- Only counts once per opportunity, even if multiple leads converted
    CASE 
      WHEN (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
        AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
      THEN 1 
      ELSE 0 
    END AS is_joined_unique,
    
    -- Cohort Months
    FORMAT_DATE('%Y-%m', DATE(FilterDate)) AS filter_date_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(stage_entered_contacting__c)) AS contacted_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(mql_stage_entered_ts)) AS mql_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(converted_date_raw)) AS sql_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(Date_Became_SQO__c)) AS sqo_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(advisor_join_date__c)) AS joined_cohort_month,
    
    -- AUM in Millions
    ROUND(COALESCE(Underwritten_AUM__c, Amount) / 1000000, 2) AS Opportunity_AUM_M,
    
    -- AUM Tier
    CASE 
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 25000000 THEN 'Tier 1 (< $25M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Tier 2 ($25M-$75M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 150000000 THEN 'Tier 3 ($75M-$150M)'
      ELSE 'Tier 4 (> $150M)'
    END AS aum_tier,
    
    -- Conversion Status (unified)
    CASE
      WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
      WHEN Disposition__c IS NOT NULL OR StageName = 'Closed Lost' THEN 'Closed'
      ELSE 'Open'
    END AS Conversion_Status,
    
    -- TOF Stage (highest stage reached)
    CASE
      WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
      WHEN LOWER(SQO_raw) = 'yes' THEN 'SQO'
      WHEN is_sql = 1 THEN 'SQL'
      WHEN is_mql = 1 THEN 'MQL'
      WHEN is_contacted = 1 THEN 'Contacted'
      ELSE 'Prospect'
    END AS TOF_Stage,
    
    -- Stage Code (numeric)
    CASE
      WHEN StageName = 'Qualifying' THEN 1
      WHEN StageName = 'Discovery' THEN 2
      WHEN StageName = 'Sales Process' THEN 3
      WHEN StageName = 'Negotiating' THEN 4
      WHEN StageName = 'Signed' THEN 5
      WHEN StageName = 'On Hold' THEN 6
      WHEN StageName = 'Closed Lost' THEN 7
      WHEN StageName = 'Joined' THEN 8
      WHEN StageName = 'Planned Nurture' THEN 9
      ELSE NULL
    END AS StageName_code,
    
    -- Record Type Name
    CASE 
      WHEN recordtypeid = '012Dn000000mrO3IAI' THEN 'Recruiting'
      WHEN recordtypeid = '012VS000009VoxrYAC' THEN 'Re-Engagement'
      ELSE 'Unknown'
    END AS record_type_name,
    
    -- Experiment Tag Array (for unnesting in specialized views)
    ARRAY(
      SELECT DISTINCT TRIM(tag)
      FROM UNNEST(SPLIT(IFNULL(Experimentation_Tag_Raw__c, ''), ';')) AS tag
      WHERE TRIM(tag) != ''
    ) AS Experimentation_Tag_List,
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- CONVERSION ELIGIBILITY FLAGS (Denominators)
    -- Only records with final outcomes are included
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- CONVERSION ELIGIBILITY FLAGS (Denominators) - COHORT MODE
    -- Only records with final outcomes are included (resolved anytime)
    -- Lead-level uses lead_closed_date, Opportunity-level uses opp_closed_date/StageName
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Contacted Eligibility (Cohort): Contacted that became MQL or closed as lead
    CASE 
      WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
      THEN 1 ELSE 0 
    END AS eligible_for_contacted_conversions,
    
    -- MQL Eligibility (Cohort): MQL that became SQL or closed as lead
    CASE 
      WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
      THEN 1 ELSE 0 
    END AS eligible_for_mql_conversions,
    
    -- SQL Eligibility (Cohort): SQL (Opportunity) that became SQO or closed lost
    -- Note: Once converted, we look at OPPORTUNITY outcomes, not Lead disposition
    CASE 
      WHEN is_sql = 1 AND (
        LOWER(SQO_raw) = 'yes' OR                    -- Became SQO (progress)
        StageName = 'Closed Lost'                     -- Closed without becoming SQO
      )
      THEN 1 
      -- Include direct opportunities (no linked lead) that became SQO
      WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
      THEN 1
      ELSE 0 
    END AS eligible_for_sql_conversions,
    
    -- SQO Eligibility (Cohort): SQO that joined or closed lost
    CASE 
      WHEN LOWER(SQO_raw) = 'yes' AND (
        (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR 
        StageName = 'Closed Lost'
      )
      THEN 1 ELSE 0 
    END AS eligible_for_sqo_conversions,
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- CONVERSION PROGRESSION FLAGS (Numerators)
    -- Records that actually progressed to the next stage
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Contacted to MQL
    -- Note: Only count as progression if MQL date is ON or AFTER FilterDate
    -- This handles recycled leads correctly - we don't want to count old MQL conversions
    CASE 
      WHEN is_contacted = 1 
        AND is_mql = 1 
        AND mql_stage_entered_ts IS NOT NULL
        AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)
      THEN 1 ELSE 0 
    END AS contacted_to_mql_progression,
    
    -- MQL to SQL
    CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END AS mql_to_sql_progression,
    
    -- SQL to SQO
    CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END AS sql_to_sqo_progression,
    
    -- SQO to Joined
    CASE 
      WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
      THEN 1 ELSE 0 
    END AS sqo_to_joined_progression
    
  FROM With_Campaign_Name wsl
)

SELECT * FROM Final