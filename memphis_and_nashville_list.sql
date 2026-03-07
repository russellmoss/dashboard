WITH target_zips AS (
  SELECT zip FROM UNNEST([
    '38101','38103','38104','38105','38106','38107','38108','38109','38111','38112','38113','38114','38115','38116','38117','38118','38119','38120','38122','38124','38125','38126','38127','38128','38130','38131','38132','38133','38134','38135','38136','38137','38138','38139','38141','38145','38147','38148','38150','38151','38152','38157','38159','38161','38163','38166','38167','38168','38173','38174','38175','38177','38181','38182','38184','38186','38187','38188','38190','38193','38194','38197',
    '38002','38016','38017','38018','38053','38632','38654','38671',
    '37201','37202','37203','37204','37205','37206','37207','37208','37209','37210','37211','37212','37213','37214','37215','37216','37217','37218','37219','37220','37221','37222','37224','37227','37228','37229','37230','37232','37234','37235','37236','37238','37239','37240','37241','37242','37243','37244','37245','37246','37247','37248','37249','37250',
    '37013','37027','37064','37066','37067','37069','37072','37075','37076','37086','37115','37122','37135','37138','37167','37189'
  ]) AS zip
),

excluded_firms AS (
  SELECT pattern AS firm_pattern
  FROM `savvy-gtm-analytics.ml_features.excluded_firms`
),

excluded_firm_crds AS (
  SELECT SAFE_CAST(firm_crd AS INT64) AS firm_crd
  FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

-- Recent promotee exclusion (same as February 2026 lead list)
recent_promotee_exclusions AS (
  SELECT DISTINCT c.RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  WHERE COALESCE(SAFE_CAST(c.PRODUCING_ADVISOR AS BOOL), FALSE) = TRUE
    AND COALESCE(SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64), 0) < 60
    AND (
      UPPER(c.TITLE_NAME) LIKE '%FINANCIAL ADVISOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%WEALTH ADVISOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%INVESTMENT ADVISOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%FINANCIAL PLANNER%'
      OR UPPER(c.TITLE_NAME) LIKE '%PORTFOLIO MANAGER%'
      OR UPPER(c.TITLE_NAME) LIKE '%SENIOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%DIRECTOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%MANAGING%'
      OR UPPER(c.TITLE_NAME) LIKE '%PRINCIPAL%'
      OR UPPER(c.TITLE_NAME) LIKE '%VP %'
      OR UPPER(c.TITLE_NAME) LIKE '%VICE PRESIDENT%'
    )
    AND NOT (
      UPPER(c.TITLE_NAME) LIKE '%ASSOCIATE%'
      OR UPPER(c.TITLE_NAME) LIKE '%ASSISTANT%'
      OR UPPER(c.TITLE_NAME) LIKE '%PARAPLANNER%'
      OR UPPER(c.TITLE_NAME) LIKE '%JUNIOR%'
      OR UPPER(c.TITLE_NAME) LIKE '%INTERN%'
      OR UPPER(c.TITLE_NAME) LIKE '%TRAINEE%'
    )
    AND NOT (
      UPPER(c.TITLE_NAME) LIKE '%FOUNDER%'
      OR UPPER(c.TITLE_NAME) LIKE '%OWNER%'
      OR UPPER(c.TITLE_NAME) LIKE '%CEO%'
      OR UPPER(c.TITLE_NAME) LIKE '% PRESIDENT%'
    )
),

-- Primary location address from branch data when available (one row per contact)
primary_address AS (
  SELECT
    RIA_CONTACT_CRD_ID,
    ANY_VALUE(TRIM(CONCAT(
      COALESCE(CAST(STREET_1 AS STRING), ''),
      ' ',
      COALESCE(CAST(CITY AS STRING), ''),
      ', ',
      COALESCE(CAST(STATE AS STRING), ''),
      ' ',
      COALESCE(CAST(POSTAL AS STRING), '')
    ))) AS primary_location_address
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_branch_data`
  WHERE COALESCE(SAFE_CAST(PRIMARY_LOCATION AS BOOL), FALSE) = TRUE
  GROUP BY RIA_CONTACT_CRD_ID
),

-- Phase 5: Salesforce history — most recent Lead per CRD (for lead_url, Status, Disposition)
sfdc_lead_latest AS (
  SELECT FA_CRD__c, lead_url, Status, Disposition__c
  FROM (
    SELECT
      FA_CRD__c,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Id, '/view') AS lead_url,
      Status,
      Disposition__c,
      ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY CreatedDate DESC) AS rn
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE (IsDeleted IS NULL OR IsDeleted = FALSE) AND FA_CRD__c IS NOT NULL AND TRIM(FA_CRD__c) != ''
  )
  WHERE rn = 1
),

-- Phase 5: Salesforce history — most recent Opportunity per CRD (for opp_url, stage, close lost reason/detail)
sfdc_opp_latest AS (
  SELECT FA_CRD__c, opp_url, StageName, IsClosed, IsWon, Closed_Lost_Reason__c, Closed_Lost_Details__c
  FROM (
    SELECT
      FA_CRD__c,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Id, '/view') AS opp_url,
      StageName,
      IsClosed,
      IsWon,
      Closed_Lost_Reason__c,
      Closed_Lost_Details__c,
      ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY CreatedDate DESC) AS rn
    FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
    WHERE (IsDeleted IS NULL OR IsDeleted = FALSE) AND FA_CRD__c IS NOT NULL AND TRIM(FA_CRD__c) != ''
  )
  WHERE rn = 1
)

SELECT
  TRIM(CONCAT(c.CONTACT_FIRST_NAME, ' ', c.CONTACT_LAST_NAME)) AS advisor_name,
  c.RIA_CONTACT_CRD_ID AS crd,
  c.PRIMARY_FIRM_NAME AS firm_name,
  SAFE_CAST(c.PRIMARY_FIRM AS INT64) AS firm_crd,
  COALESCE(SAFE_CAST(f.TOTAL_AUM AS INT64), SAFE_CAST(c.PRIMARY_FIRM_TOTAL_AUM AS INT64)) AS firm_aum,
  COALESCE(pa.primary_location_address,
    TRIM(CONCAT(
      COALESCE(CAST(c.PRIMARY_LOCATION_CITY AS STRING), ''),
      ', ',
      COALESCE(CAST(c.PRIMARY_LOCATION_STATE AS STRING), ''),
      ' ',
      COALESCE(CAST(c.PRIMARY_LOCATION_POSTAL AS STRING), '')
    ))
  ) AS primary_location_address,
  TRIM(CAST(c.PRIMARY_LOCATION_CITY AS STRING)) AS city,
  TRIM(CAST(c.PRIMARY_LOCATION_STATE AS STRING)) AS state,
  c.TITLE_NAME AS job_title,
  c.LINKEDIN_PROFILE_URL AS linkedin_url,
  c.EMAIL AS email,
  c.PERSONAL_EMAIL_ADDRESS AS personal_email,
  c.MOBILE_PHONE_NUMBER AS mobile_phone,
  c.OFFICE_PHONE_NUMBER AS office_phone,
  -- Phase 5: Salesforce history (most recent Lead and Opportunity per CRD)
  l.lead_url,
  l.Status AS lead_status,
  l.Disposition__c AS lead_disposition,
  o.opp_url,
  o.StageName AS opp_stage_name,
  o.IsClosed AS opp_is_closed,
  o.IsWon AS opp_is_won,
  o.Closed_Lost_Reason__c AS closed_lost_reason,
  o.Closed_Lost_Details__c AS closed_lost_details
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
INNER JOIN target_zips t
  ON TRIM(CAST(c.PRIMARY_LOCATION_POSTAL AS STRING)) = t.zip
LEFT JOIN excluded_firms ef
  ON UPPER(TRIM(CAST(c.PRIMARY_FIRM_NAME AS STRING))) LIKE CAST(ef.firm_pattern AS STRING)
LEFT JOIN excluded_firm_crds ec
  ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = ec.firm_crd
LEFT JOIN recent_promotee_exclusions rp
  ON c.RIA_CONTACT_CRD_ID = rp.crd
LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
  ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = f.CRD_ID
LEFT JOIN primary_address pa
  ON c.RIA_CONTACT_CRD_ID = pa.RIA_CONTACT_CRD_ID
LEFT JOIN sfdc_lead_latest l
  ON l.FA_CRD__c = CAST(SAFE_CAST(ROUND(SAFE_CAST(c.RIA_CONTACT_CRD_ID AS FLOAT64), 0) AS INT64) AS STRING)
LEFT JOIN sfdc_opp_latest o
  ON o.FA_CRD__c = CAST(SAFE_CAST(ROUND(SAFE_CAST(c.RIA_CONTACT_CRD_ID AS FLOAT64), 0) AS INT64) AS STRING)
WHERE COALESCE(SAFE_CAST(c.PRODUCING_ADVISOR AS BOOL), FALSE) = TRUE
  AND c.CONTACT_FIRST_NAME IS NOT NULL
  AND c.CONTACT_LAST_NAME IS NOT NULL
  AND c.PRIMARY_FIRM IS NOT NULL
  AND c.PRIMARY_FIRM_NAME IS NOT NULL
  AND ef.firm_pattern IS NULL
  AND ec.firm_crd IS NULL
  AND (c.AGE_RANGE IS NULL OR c.AGE_RANGE NOT IN ('70-74','75-79','80-84','85-89','90-94','95-99'))
  -- No disclosures (same set as lead scoring V3.5.2)
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_CRIMINAL AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_TERMINATION AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_INVESTIGATION AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_CIVIL_EVENT AS BOOL), FALSE) = FALSE
  AND COALESCE(SAFE_CAST(c.CONTACT_HAS_DISCLOSED_BOND AS BOOL), FALSE) = FALSE
  -- Excluded titles (same as February 2026 lead list)
  AND NOT (
    UPPER(c.TITLE_NAME) LIKE '%FINANCIAL SOLUTIONS ADVISOR%'
    OR UPPER(c.TITLE_NAME) LIKE '%PARAPLANNER%'
    OR UPPER(c.TITLE_NAME) LIKE '%ASSOCIATE ADVISOR%'
    OR UPPER(c.TITLE_NAME) LIKE '%OPERATIONS%'
    OR UPPER(c.TITLE_NAME) LIKE '%WHOLESALER%'
    OR UPPER(c.TITLE_NAME) LIKE '%COMPLIANCE%'
    OR UPPER(c.TITLE_NAME) LIKE '%ASSISTANT%'
    OR UPPER(c.TITLE_NAME) LIKE '%INSURANCE AGENT%'
    OR UPPER(c.TITLE_NAME) LIKE '%INSURANCE%'
    OR UPPER(c.TITLE_NAME) LIKE '%CHIEF FINANCIAL OFFICER%'
    OR UPPER(c.TITLE_NAME) LIKE '%CFO%'
    OR UPPER(c.TITLE_NAME) LIKE '%CHIEF INVESTMENT OFFICER%'
    OR UPPER(c.TITLE_NAME) LIKE '%CIO%'
    OR UPPER(c.TITLE_NAME) LIKE '%VICE PRESIDENT%'
    OR UPPER(c.TITLE_NAME) LIKE '%VP %'
  )
  AND rp.crd IS NULL
ORDER BY c.PRIMARY_FIRM_NAME, c.CONTACT_LAST_NAME, c.CONTACT_FIRST_NAME;
