WITH base_tasks AS (
  SELECT
    t.Id,
    t.CreatedDate,
    t.Status,
    t.Subject,
    t.Type,
    t.TaskSubtype,
    t.CallDurationInSeconds,
    t.WhoId,
    t.WhatId,
    u.Name AS executor_name,
    u.Id AS executor_id,
    u.CreatedDate AS executor_created_date,
    f.SGA_Owner_Name__c,
    f.SGM_Owner_Name__c AS sgm_name,
    -- Get SGA flags from User table
    sga_user.IsSGA__c AS SGA_IsSGA__c,
    sga_user.IsActive AS SGA_IsActive,
    f.Full_prospect_id__c,
    f.Full_Opportunity_ID__c,
    f.StageName,
    f.TOF_Stage,
    f.is_contacted,
    f.is_mql,
    f.is_sql,
    f.is_sqo,
    f.is_joined,
    f.Initial_Call_Scheduled_Date__c,
    f.Qualification_Call_Date__c,
    f.Date_Became_SQO__c,
    f.Stage_Entered_Closed__c,
    f.advisor_name,
    -- vw_funnel_master uses advisor_name (COALESCE(Opp_Name, Prospect_Name))
    -- For backward compatibility, we'll derive Prospect_Name and Opp_Name
    CASE 
      WHEN f.Full_prospect_id__c IS NOT NULL THEN f.advisor_name
      ELSE NULL
    END AS Prospect_Name,
    CASE 
      WHEN f.Full_Opportunity_ID__c IS NOT NULL THEN f.advisor_name
      ELSE NULL
    END AS Opp_Name,
    NULL AS Company,  -- Not available in vw_funnel_master
    NULL AS Lead_Original_Source,  -- Not directly available, but Original_source exists
    f.Original_source,
    f.Channel_Grouping_Name,
    f.Opportunity_AUM,
    f.Amount,
    f.Underwritten_AUM__c,
    
    -- ---------------------------------------------------------------------------
    -- OUTBOUND CALL SEQUENCE NUMBER (for "first call" logic)
    -- ---------------------------------------------------------------------------
    -- Numbers each outbound call to a prospect in chronological order.
    -- Only counts actual outbound calls, not all activities.
    -- Uses COALESCE to handle both Lead-based and Opportunity-based records.
    CASE 
      WHEN NOT (
        t.Type LIKE 'Incoming%'
        OR t.Subject LIKE '%Incoming%'
        OR t.Subject LIKE '%Inbound%'
        OR t.Subject LIKE 'Submitted Form%'
      )
      AND (
        t.Type = 'Call'
        OR t.TaskSubtype = 'Call'
        OR t.Subject LIKE '%Call%'
        OR t.Subject LIKE '%answered%'
        OR t.Subject LIKE '%Left VM%'
        OR t.Subject LIKE '%Voicemail%'
        OR t.Subject LIKE 'missed:%'
      )
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(f.Full_prospect_id__c, f.Full_Opportunity_ID__c)
        ORDER BY t.CreatedDate ASC
      )
      ELSE NULL
    END AS outbound_call_sequence_num
    
  FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
  INNER JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
    ON t.OwnerId = u.Id
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
    ON (t.WhoId = f.Full_prospect_id__c OR t.WhatId = f.Full_Opportunity_ID__c)
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
    ON f.SGA_Owner_Name__c = sga_user.Name
  WHERE t.IsDeleted = FALSE
    AND t.Subject NOT LIKE '%Step skipped%'
),
-- Deduplicate: When a task links to both Lead and Opportunity, prefer the Lead match
deduplicated_tasks AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY Id
      ORDER BY 
        -- Prefer Lead match (WhoId) over Opportunity match (WhatId)
        CASE WHEN WhoId = Full_prospect_id__c THEN 1 ELSE 2 END,
        -- If both are Lead matches or both Opportunity, prefer the one with more complete data
        CASE WHEN Full_prospect_id__c IS NOT NULL AND Full_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 2 END
    ) as row_rank
  FROM base_tasks
)

SELECT
  -- ---------------------------------------------------------------------------
  -- 1. IDENTIFIERS & DATES (With Timezone Conversion)
  -- ---------------------------------------------------------------------------
  Id AS task_id,
  CreatedDate AS task_created_date_utc,
  DATE(CreatedDate) AS task_created_date,
  DATE(CreatedDate, 'America/New_York') AS task_created_date_est,
  
  DATETIME(CreatedDate, 'America/New_York') AS task_created_datetime_est,
  DATE(CreatedDate, 'America/New_York') AS task_activity_date,
  EXTRACT(HOUR FROM DATETIME(CreatedDate, 'America/New_York')) AS activity_hour_est,
  FORMAT_DATE('%A', DATE(CreatedDate, 'America/New_York')) AS activity_day_of_week,
  
  Status AS task_status,
  Subject AS task_subject,
  Type AS task_type,
  TaskSubtype AS task_subtype,
  CallDurationInSeconds AS call_duration_seconds,
  WhoId AS task_who_id,
  WhatId AS task_what_id,

  -- ---------------------------------------------------------------------------
  -- 2. WHO DID IT (The Executor)
  -- ---------------------------------------------------------------------------
  executor_name AS task_executor_name,
  executor_id AS task_executor_id,
  executor_created_date AS task_executor_created_date,

  -- ---------------------------------------------------------------------------
  -- 3. RAMP STATUS
  -- ---------------------------------------------------------------------------
  CASE
    WHEN DATE_DIFF(DATE(CreatedDate), DATE(executor_created_date), DAY) <= 30 THEN 'On Ramp'
    ELSE 'Post-Ramp'
  END AS activity_ramp_status,

  -- ---------------------------------------------------------------------------
  -- 4. CHANNEL CATEGORIZATION (THE WATERFALL)
  -- ---------------------------------------------------------------------------
  CASE
    WHEN Subject LIKE '%Step skipped%' THEN NULL
    WHEN Subject LIKE 'Submitted Form%' OR Subject LIKE '%HubSpot%' THEN 'Marketing'
    WHEN Type LIKE '%SMS%' OR Subject LIKE '%SMS%' OR Subject LIKE '%Text%' THEN 'SMS'
    WHEN Subject LIKE '%LinkedIn%' OR TaskSubtype = 'LinkedIn' OR Subject LIKE '%LI %' THEN 'LinkedIn'
    WHEN Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    THEN 'Call'
    WHEN Subject LIKE 'Sent Savvy raised%' THEN 'Email (Blast)'
    WHEN Subject LIKE '%[lemlist]%' 
      OR Subject LIKE '%List Email%'
      OR TaskSubtype = 'ListEmail'
    THEN 'Email (Campaign)'
    WHEN Type = 'Email'
      OR TaskSubtype = 'Email'
      OR Subject LIKE 'Email:%'
      OR Subject LIKE 'Sent %'
    THEN 'Email (Manual)'
    WHEN TaskSubtype = 'Event'
      OR Subject LIKE '%Meeting%'
      OR Subject LIKE '%In Person%'
      OR Subject LIKE '%Zoom%'
      OR Subject LIKE '%Demo%'
    THEN 'Meeting'
    ELSE 'Other'
  END AS activity_channel,

  -- ---------------------------------------------------------------------------
  -- 4b. CHANNEL GROUP (High-Level Bucket)
  -- ---------------------------------------------------------------------------
  CASE
    WHEN Subject LIKE '%Step skipped%' THEN NULL
    WHEN Subject LIKE 'Submitted Form%' OR Subject LIKE '%HubSpot%' THEN 'Marketing'
    WHEN Type LIKE '%SMS%' OR Subject LIKE '%SMS%' OR Subject LIKE '%Text%' THEN 'SMS'
    WHEN Subject LIKE '%LinkedIn%' OR TaskSubtype = 'LinkedIn' OR Subject LIKE '%LI %' THEN 'LinkedIn'
    WHEN Type = 'Call' OR TaskSubtype = 'Call' OR Subject LIKE '%Call%' OR Subject LIKE '%answered%' OR Subject LIKE '%Left VM%' OR Subject LIKE '%Voicemail%' OR Subject LIKE 'missed:%' THEN 'Call'
    WHEN Subject LIKE '%[lemlist]%' 
      OR Subject LIKE '%List Email%'
      OR TaskSubtype = 'ListEmail'
      OR Subject LIKE 'Sent Savvy raised%' 
      OR Type = 'Email' 
      OR TaskSubtype = 'Email' 
      OR Subject LIKE 'Email:%' 
      OR Subject LIKE 'Sent %' 
    THEN 'Email'
    WHEN TaskSubtype = 'Event' OR Subject LIKE '%Meeting%' OR Subject LIKE '%In Person%' OR Subject LIKE '%Zoom%' OR Subject LIKE '%Demo%' THEN 'Meeting'
    ELSE 'Other'
  END AS activity_channel_group,

  -- ---------------------------------------------------------------------------
  -- 5. DIRECTION & QUALITY SIGNALS
  -- ---------------------------------------------------------------------------
  CASE
    WHEN Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    THEN 'Inbound'
    ELSE 'Outbound'
  END AS direction,

  CASE
    WHEN Type = 'Incoming SMS' OR Subject LIKE '%Incoming SMS%' THEN 1
    WHEN Subject LIKE '%answered%' AND Subject NOT LIKE '%missed:%' THEN 1
    WHEN CallDurationInSeconds > 120 THEN 1
    ELSE 0
  END AS is_meaningful_connect,

  CASE
    WHEN Subject LIKE 'Submitted Form%' OR executor_name = 'Savvy Marketing' THEN 1
    ELSE 0
  END AS is_marketing_activity,

  -- ---------------------------------------------------------------------------
  -- 6. OUTCOME & CONTEXT (From Funnel View)
  -- ---------------------------------------------------------------------------
  SGA_Owner_Name__c,
  sgm_name,
  SGA_IsSGA__c,
  SGA_IsActive,
  Full_prospect_id__c,
  Full_Opportunity_ID__c,
  StageName,
  TOF_Stage,

  COALESCE(is_contacted, 0) AS is_contacted,
  COALESCE(is_mql, 0) AS is_mql,
  COALESCE(is_sql, 0) AS is_sql,
  COALESCE(is_sqo, 0) AS is_sqo,
  COALESCE(is_joined, 0) AS is_joined,

  -- ---------------------------------------------------------------------------
  -- 7. FUTURE PLANNING (The Radar)
  -- ---------------------------------------------------------------------------
  Initial_Call_Scheduled_Date__c,
  Qualification_Call_Date__c,
  Date_Became_SQO__c,
  Stage_Entered_Closed__c,

  -- ---------------------------------------------------------------------------
  -- 7b. COLD CALL IDENTIFICATION (Original - kept for backwards compatibility)
  -- ---------------------------------------------------------------------------
  CASE
    WHEN NOT (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    )
    AND (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    )
    AND (
      Initial_Call_Scheduled_Date__c IS NULL
      OR DATE(CreatedDate, 'America/New_York') != DATE(Initial_Call_Scheduled_Date__c)
    )
    THEN 1
    ELSE 0
  END AS is_cold_call,
  
  -- Call Type Classification
  CASE
    WHEN NOT (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    )
    AND (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    )
    AND (
      Initial_Call_Scheduled_Date__c IS NULL
      OR DATE(CreatedDate, 'America/New_York') != DATE(Initial_Call_Scheduled_Date__c)
    )
    THEN 'Cold Call'
    WHEN NOT (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    )
    AND (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    )
    AND (
      Initial_Call_Scheduled_Date__c IS NOT NULL
      AND DATE(CreatedDate, 'America/New_York') = DATE(Initial_Call_Scheduled_Date__c)
    )
    THEN 'Scheduled Call'
    WHEN (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    )
    AND (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    )
    THEN 'Inbound Call'
    ELSE 'Not a Call'
  END AS call_type,

  -- ---------------------------------------------------------------------------
  -- 7c. TRUE COLD CALL (Updated Dec 2025)
  -- ---------------------------------------------------------------------------
  -- A "True Cold Call" is the FIRST outbound call to a prospect where:
  --   1. Prospect hasn't MQL'ed yet (pre-MQL outreach), OR
  --   2. Re-engagement: Closed Lost AND 180+ days after Stage_Entered_Closed__c
  --   3. NOT on a scheduled call date
  --   4. Has valid linkage (not orphan) and not self-reference
  
  CASE
    -- Must be an outbound call (not inbound)
    WHEN NOT (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    )
    -- Must be categorized as a Call
    AND (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    )
    -- Must NOT be on a scheduled call date
    AND (
      Initial_Call_Scheduled_Date__c IS NULL
      OR DATE(CreatedDate, 'America/New_York') != DATE(Initial_Call_Scheduled_Date__c)
    )
    -- Must have valid linkage (not orphan)
    AND (Full_prospect_id__c IS NOT NULL OR Full_Opportunity_ID__c IS NOT NULL)
    -- Must have advisor name
    AND advisor_name IS NOT NULL
    -- Must not be self-reference
    AND LOWER(TRIM(COALESCE(advisor_name, ''))) != LOWER(TRIM(executor_name))
    -- Must be the FIRST outbound call to this prospect
    AND outbound_call_sequence_num = 1
    -- Must be either: Pre-MQL OR Re-engagement (180+ days after closed lost)
    AND (
      -- Option A: Pre-MQL prospect (hasn't MQL'ed yet)
      COALESCE(is_mql, 0) = 0
      OR
      -- Option B: Re-engagement - Closed Lost AND 180+ days after Stage_Entered_Closed__c
      (
        StageName = 'Closed Lost'
        AND Stage_Entered_Closed__c IS NOT NULL
        AND DATE_DIFF(DATE(CreatedDate, 'America/New_York'), DATE(Stage_Entered_Closed__c), DAY) >= 180
      )
    )
    THEN 1
    ELSE 0
  END AS is_true_cold_call,

  -- ---------------------------------------------------------------------------
  -- 7d. COLD CALL QUALITY & CLASSIFICATION
  -- ---------------------------------------------------------------------------
  -- Explains why a call is or isn't a "true cold call"
  
  CASE
    -- Not an outbound call
    WHEN (
      Type LIKE 'Incoming%'
      OR Subject LIKE '%Incoming%'
      OR Subject LIKE '%Inbound%'
      OR Subject LIKE 'Submitted Form%'
    ) THEN 'Not Outbound'
    
    -- Not a call at all
    WHEN NOT (
      Type = 'Call'
      OR TaskSubtype = 'Call'
      OR Subject LIKE '%Call%'
      OR Subject LIKE '%answered%'
      OR Subject LIKE '%Left VM%'
      OR Subject LIKE '%Voicemail%'
      OR Subject LIKE 'missed:%'
    ) THEN 'Not a Call'
    
    -- Scheduled call (matches Initial_Call_Scheduled_Date__c)
    WHEN Initial_Call_Scheduled_Date__c IS NOT NULL
      AND DATE(CreatedDate, 'America/New_York') = DATE(Initial_Call_Scheduled_Date__c)
    THEN 'Scheduled Call'
    
    -- ORPHAN: No Lead or Opportunity linked
    WHEN Full_prospect_id__c IS NULL AND Full_Opportunity_ID__c IS NULL
    THEN 'Orphan - No Lead/Opp Linked'
    
    -- MISSING NAME: Has linkage but no advisor name
    WHEN advisor_name IS NULL
    THEN 'Missing Advisor Name'
    
    -- SELF-REFERENCE: Advisor name equals SGA name
    WHEN LOWER(TRIM(COALESCE(advisor_name, ''))) = LOWER(TRIM(executor_name))
    THEN 'Self-Reference'
    
    -- Not first call to this prospect
    WHEN outbound_call_sequence_num > 1
    THEN 'Repeat Call (Not First)'
    
    -- Already MQL'ed and not a valid re-engagement
    WHEN COALESCE(is_mql, 0) = 1
      AND NOT (
        StageName = 'Closed Lost'
        AND Stage_Entered_Closed__c IS NOT NULL
        AND DATE_DIFF(DATE(CreatedDate, 'America/New_York'), DATE(Stage_Entered_Closed__c), DAY) >= 180
      )
    THEN 'Post-MQL (Not Re-engagement)'
    
    -- Valid cold call
    ELSE 'Valid Cold Call'
  END AS cold_call_quality,

  -- ---------------------------------------------------------------------------
  -- 7e. OUTBOUND CALL SEQUENCE (for analysis)
  -- ---------------------------------------------------------------------------
  outbound_call_sequence_num,

  -- ---------------------------------------------------------------------------
  -- 8. CONTEXT FIELDS
  -- ---------------------------------------------------------------------------
  advisor_name,
  Prospect_Name,
  Opp_Name,
  Company,
  Lead_Original_Source,
  Original_source,
  Channel_Grouping_Name,
  Opportunity_AUM,
  Amount,
  Underwritten_AUM__c

FROM deduplicated_tasks
WHERE row_rank = 1
-- Deduplication: When a task links to both Lead (WhoId) and Opportunity (WhatId),
-- prefer the Lead match to prevent duplicate rows
-- 
-- This view is based on vw_funnel_master (Tableau_Views) for consistency
-- with the main funnel dashboard
