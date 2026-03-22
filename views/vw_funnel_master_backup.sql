-- BACKUP of vw_funnel_master taken 2026-03-22
-- Retrieved from savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.VIEWS
-- DO NOT MODIFY — use vw_funnel_master.sql for edits

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` AS
WITH Lead_Base AS (
  SELECT
    Id AS Full_prospect_id__c,
    Name AS Prospect_Name,
    ConvertedOpportunityId AS converted_oppty_id,
    CreatedDate,
    OwnerId AS Lead_OwnerId,
    Final_Source__c AS Lead_Original_Source,
    Final_Source__c AS Final_Source,
    Finance_View__c AS Lead_Finance_View__c,
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
    SGA_Owner_Name__c AS Lead_SGA_Owner_Name__c,
    Next_Steps__c AS Lead_Next_Steps__c,
    Initial_Call_Scheduled_Date__c,
    Stage_Entered_Closed__c AS lead_closed_date,
    CAST(NULL AS STRING) AS Previous_Recruiting_Opportunity_ID__c,
    CAST(NULL AS STRING) AS ContactId,
    'Lead' AS lead_record_source,
    CAST(NULL AS STRING) AS lead_StageName,
    CAST(NULL AS STRING) AS lead_Closed_Lost_Reason__c,
    CAST(NULL AS STRING) AS lead_Closed_Lost_Details__c,
    GREATEST(
      IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
      IFNULL(stage_entered_new__c, TIMESTAMP('1900-01-01')),
      IFNULL(stage_entered_contacting__c, TIMESTAMP('1900-01-01'))
    ) AS Lead_FilterDate
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
),

Campaign_Member_Agg_By_Lead AS (
  SELECT
    LeadId,
    ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns
  FROM (
    SELECT DISTINCT
      cm.LeadId,
      cm.CampaignId,
      c.Name AS CampaignName
    FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
      ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.LeadId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY LeadId
),

Campaign_Member_Agg_By_Contact AS (
  SELECT
    ContactId,
    ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns
  FROM (
    SELECT DISTINCT
      cm.ContactId,
      cm.CampaignId,
      c.Name AS CampaignName
    FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
      ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.ContactId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY ContactId
),

ReEngagement_As_Lead AS (
  SELECT
    Full_Opportunity_ID__c AS Full_prospect_id__c,
    Name AS Prospect_Name,
    Created_Recruiting_Opportunity_ID__c AS converted_oppty_id,
    CreatedDate,
    OwnerId AS Lead_OwnerId,
    Final_Source__c AS Lead_Original_Source,
    Final_Source__c AS Final_Source,
    Finance_View__c AS Lead_Finance_View__c,
    Stage_Entered_Outreach__c AS stage_entered_contacting__c,
    Stage_Entered_Call_Scheduled__c AS mql_stage_entered_ts,
    DATE(Stage_Entered_Re_Engaged__c) AS converted_date_raw,
    CASE
      WHEN Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN TRUE
      ELSE FALSE
    END AS IsConverted,
    CAST(NULL AS STRING) AS Disposition__c,
    FALSE AS DoNotCall,
    COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate) AS stage_entered_new__c,
    Experimentation_Tag__c AS Lead_Experimentation_Tag__c,
    CampaignId AS Lead_Campaign_Id__c,
    CAST(NULL AS STRING) AS Lead_Score_Tier__c,
    External_Agency__c AS Lead_External_Agency__c,
    Opportunity_Owner_Name__c AS Lead_SGA_Owner_Name__c,
    CAST(NULL AS STRING) AS Lead_Next_Steps__c,
    CAST(NULL AS DATE) AS Initial_Call_Scheduled_Date__c,
    Stage_Entered_Closed__c AS lead_closed_date,
    Previous_Recruiting_Opportunity_ID__c,
    ContactId,
    'Re-Engagement' AS lead_record_source,
    StageName AS lead_StageName,
    Closed_Lost_Reason__c AS lead_Closed_Lost_Reason__c,
    Closed_Lost_Details__c AS lead_Closed_Lost_Details__c,
    GREATEST(
      IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Planned_Nurture__c, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Outreach__c, TIMESTAMP('1900-01-01'))
    ) AS Lead_FilterDate
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE RecordTypeId = '012VS000009VoxrYAC'
    AND (IsDeleted IS NULL OR IsDeleted = FALSE)
),

All_Leads AS (
  SELECT * FROM Lead_Base
  UNION ALL
  SELECT * FROM ReEngagement_As_Lead
),

Opp_Base AS (
  SELECT
    Id AS Full_Opportunity_ID__c,
    Name AS Opp_Name,
    OwnerId AS Opp_OwnerId,
    Final_Source__c AS Opp_Original_Source,
    Finance_View__c AS Opp_Finance_View__c,
    SGA__c AS Opp_SGA_Name,
    Opportunity_Owner_Name__c AS Opp_SGM_Name,
    SQL__c AS SQO_raw,
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
  WHERE RecordTypeId = '012Dn000000mrO3IAI'
),

Combined AS (
  SELECT
    COALESCE(l.Full_prospect_id__c, o.Full_Opportunity_ID__c) AS primary_key,
    l.Full_prospect_id__c,
    o.Full_Opportunity_ID__c,
    COALESCE(o.Opp_Name, l.Prospect_Name) AS advisor_name,
    ROW_NUMBER() OVER (
      PARTITION BY o.Full_Opportunity_ID__c
      ORDER BY l.CreatedDate ASC NULLS LAST
    ) AS opp_row_num,
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
    COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,
    COALESCE(o.Opp_Finance_View__c, l.Lead_Finance_View__c, 'Other') AS Finance_View__c,
    COALESCE(o.Opp_External_Agency__c, l.Lead_External_Agency__c) AS External_Agency__c,
    l.Lead_SGA_Owner_Name__c AS SGA_Owner_Name__c,
    o.Opp_SGA_Name AS Opp_SGA_Name__c,
    o.Opp_SGM_Name AS SGM_Owner_Name__c,
    l.Lead_Next_Steps__c AS Next_Steps__c,
    o.Opp_NextStep AS NextStep,
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
    CASE WHEN l.stage_entered_contacting__c IS NOT NULL THEN 1 ELSE 0 END AS is_contacted,
    CASE WHEN l.mql_stage_entered_ts IS NOT NULL THEN 1 ELSE 0 END AS is_mql,
    CASE WHEN l.IsConverted IS TRUE THEN 1 ELSE 0 END AS is_sql,
    CASE WHEN LOWER(o.SQO_raw) = 'yes' THEN 1 ELSE 0 END AS is_sqo,
    -- FIX: Exclude Closed Lost from is_joined (advisors who joined then left should not count)
    CASE WHEN (o.advisor_join_date__c IS NOT NULL OR o.StageName = 'Joined')
         AND COALESCE(o.StageName, '') != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined,
    COALESCE(o.StageName, l.lead_StageName) AS StageName,
    o.SQO_raw,
    l.Disposition__c,
    l.DoNotCall,
    COALESCE(o.Closed_Lost_Reason__c, l.lead_Closed_Lost_Reason__c) AS Closed_Lost_Reason__c,
    COALESCE(o.Closed_Lost_Details__c, l.lead_Closed_Lost_Details__c) AS Closed_Lost_Details__c,
    COALESCE(o.Underwritten_AUM__c, o.Amount) AS Opportunity_AUM,
    o.Underwritten_AUM__c,
    o.Amount,
    COALESCE(o.Opportunity_Experimentation_Tag__c, l.Lead_Experimentation_Tag__c) AS Experimentation_Tag_Raw__c,
    COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c,
    l.Lead_Campaign_Id__c,
    o.Opp_Campaign_Id__c,
    COALESCE(cma_lead.all_campaigns, cma_contact.all_campaigns) AS all_campaigns,
    o.RecordTypeId AS recordtypeid,
    l.Lead_Score_Tier__c,
    l.Previous_Recruiting_Opportunity_ID__c,
    l.lead_record_source,
    CASE
      WHEN l.Previous_Recruiting_Opportunity_ID__c IS NOT NULL
      THEN CONCAT(
        'https://savvywealth.lightning.force.com/lightning/r/Opportunity/',
        l.Previous_Recruiting_Opportunity_ID__c,
        '/view'
      )
      ELSE NULL
    END AS origin_opportunity_url
  FROM All_Leads l
  FULL OUTER JOIN Opp_Base o
    ON l.converted_oppty_id = o.Full_Opportunity_ID__c
  LEFT JOIN Campaign_Member_Agg_By_Lead cma_lead
    ON cma_lead.LeadId = l.Full_prospect_id__c
  LEFT JOIN Campaign_Member_Agg_By_Contact cma_contact
    ON cma_contact.ContactId = l.ContactId
    AND l.lead_record_source = 'Re-Engagement'
),

With_Channel_Mapping AS (
  SELECT
    c.*,
    IFNULL(c.Finance_View__c, 'Other') AS Channel_Grouping_Name_Raw,
    CASE IFNULL(c.Finance_View__c, 'Other')
      WHEN 'Partnerships' THEN 'Recruitment Firm'
      WHEN 'Job Applications' THEN 'Marketing'
      WHEN 'Employee Referral' THEN 'Referral'
      WHEN 'Advisor Referral' THEN 'Referral'
      ELSE IFNULL(c.Finance_View__c, 'Other')
    END AS Channel_Grouping_Name
  FROM Combined c
),

With_SGA_Lookup AS (
  SELECT
    wcm.*,
    u.Name AS Opp_SGA_User_Name
  FROM With_Channel_Mapping wcm
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
    ON wcm.Opp_SGA_Name__c = u.Id
),

With_Campaign_Name AS (
  SELECT
    wsl.*,
    c.Name AS Campaign_Name__c
  FROM With_SGA_Lookup wsl
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
    ON wsl.Campaign_Id__c = c.Id
),

Final AS (
  SELECT
    wsl.* EXCEPT(SGA_Owner_Name__c),
    COALESCE(wsl.SGA_Owner_Name__c, wsl.Opp_SGA_User_Name) AS SGA_Owner_Name__c,
    CASE
      WHEN Full_Opportunity_ID__c IS NULL THEN 1
      WHEN opp_row_num = 1 THEN 1
      ELSE 0
    END AS is_primary_opp_record,
    CASE
      WHEN LOWER(SQO_raw) = 'yes'
        AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
      THEN 1
      ELSE 0
    END AS is_sqo_unique,
    -- FIX: Exclude Closed Lost from is_joined_unique
    CASE
      WHEN (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
        AND StageName != 'Closed Lost'
        AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
      THEN 1 ELSE 0
    END AS is_joined_unique,
    FORMAT_DATE('%Y-%m', DATE(FilterDate)) AS filter_date_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(stage_entered_contacting__c)) AS contacted_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(mql_stage_entered_ts)) AS mql_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(converted_date_raw)) AS sql_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(Date_Became_SQO__c)) AS sqo_cohort_month,
    FORMAT_DATE('%Y-%m', DATE(advisor_join_date__c)) AS joined_cohort_month,
    ROUND(COALESCE(Underwritten_AUM__c, Amount) / 1000000, 2) AS Opportunity_AUM_M,
    CASE
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 25000000 THEN 'Tier 1 (< $25M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Tier 2 ($25M-$75M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 150000000 THEN 'Tier 3 ($75M-$150M)'
      ELSE 'Tier 4 (> $150M)'
    END AS aum_tier,
    -- FIX: Closed Lost takes priority over join date in Conversion_Status
    CASE
      WHEN StageName = 'Closed Lost' THEN 'Closed'
      WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
      WHEN Disposition__c IS NOT NULL THEN 'Closed'
      ELSE 'Open'
    END AS Conversion_Status,
    -- FIX: Closed Lost takes priority over join date in TOF_Stage
    CASE
      WHEN StageName = 'Closed Lost' THEN 'Closed'
      WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
      WHEN LOWER(SQO_raw) = 'yes' THEN 'SQO'
      WHEN is_sql = 1 THEN 'SQL'
      WHEN is_mql = 1 THEN 'MQL'
      WHEN is_contacted = 1 THEN 'Contacted'
      ELSE 'Prospect'
    END AS TOF_Stage,
    CASE
      WHEN StageName = 'Qualifying' THEN 1
      WHEN StageName = 'Discovery' THEN 2
      WHEN StageName = 'Sales Process' THEN 3
      WHEN StageName = 'Negotiating' THEN 4
      WHEN StageName = 'Signed' THEN 5
      WHEN StageName = 'On Hold' THEN 6
      WHEN StageName = 'Closed Lost' THEN 7
      WHEN StageName = 'Joined' THEN 8
      ELSE NULL
    END AS StageName_code,
    CASE
      WHEN wsl.lead_record_source = 'Re-Engagement' THEN 'Re-Engagement'
      WHEN recordtypeid = '012Dn000000mrO3IAI' THEN 'Recruiting'
      ELSE 'Unknown'
    END AS record_type_name,
    wsl.lead_record_source AS prospect_source_type,
    ARRAY(
      SELECT DISTINCT TRIM(tag)
      FROM UNNEST(SPLIT(IFNULL(Experimentation_Tag_Raw__c, ''), ';')) AS tag
      WHERE TRIM(tag) != ''
    ) AS Experimentation_Tag_List,
    CASE
      WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
      THEN 1 ELSE 0
    END AS eligible_for_contacted_conversions,
    CASE
      WHEN is_contacted = 1 AND (
        is_mql = 1
        OR lead_closed_date IS NOT NULL
        OR (
          mql_stage_entered_ts IS NULL
          AND lead_closed_date IS NULL
          AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE()
        )
      )
      THEN 1 ELSE 0
    END AS eligible_for_contacted_conversions_30d,
    CASE
      WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
      THEN 1 ELSE 0
    END AS eligible_for_mql_conversions,
    CASE
      WHEN is_sql = 1 AND (
        LOWER(SQO_raw) = 'yes' OR
        StageName = 'Closed Lost'
      )
      THEN 1
      WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
      THEN 1
      ELSE 0
    END AS eligible_for_sql_conversions,
    CASE
      WHEN LOWER(SQO_raw) = 'yes' AND (
        (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR
        StageName = 'Closed Lost'
      )
      THEN 1 ELSE 0
    END AS eligible_for_sqo_conversions,
    CASE
      WHEN is_contacted = 1
        AND is_mql = 1
        AND mql_stage_entered_ts IS NOT NULL
        AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)
      THEN 1 ELSE 0
    END AS contacted_to_mql_progression,
    CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END AS mql_to_sql_progression,
    CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END AS sql_to_sqo_progression,
    -- FIX: Exclude Closed Lost from sqo_to_joined_progression
    CASE
      WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
        AND StageName != 'Closed Lost'
      THEN 1 ELSE 0
    END AS sqo_to_joined_progression
  FROM With_Campaign_Name wsl
)

SELECT * FROM Final