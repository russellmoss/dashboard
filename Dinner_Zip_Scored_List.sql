-- ============================================================================
-- DINNER ZIP CODE ADVISOR LIST — SCORED (Pipeline V3.7.0 Rules Applied)
-- ============================================================================
-- Finds ALL producing advisors whose PRIMARY_LOCATION_POSTAL matches
-- savvy-gtm-analytics.ml_features.Dinner_Zip_Codes, then scores them
-- through the V3.7.0 pipeline.  Every advisor gets a tier OR exclusion reason.
-- Output: ml_features.dinner_zip_scored_list  (export to Google Sheets)
-- ============================================================================

CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.dinner_zip_scored_list` AS

WITH
-- ============================================================================
-- A. DINNER ZIP CODES (source list of target zips + dinner city)
-- ============================================================================
dinner_zips AS (
    SELECT
        CAST(PRIMARY_LOCATION_POSTAL AS STRING) AS zip_code,
        DINNER_CITY
    FROM `savvy-gtm-analytics.ml_features.Dinner_Zip_Codes`
),

-- ============================================================================
-- A2. ALL ADVISORS IN THOSE ZIP CODES (the universe we score)
-- ============================================================================
zip_matched_advisors AS (
    SELECT DISTINCT
        c.RIA_CONTACT_CRD_ID AS crd,
        dz.DINNER_CITY,
        dz.zip_code AS dinner_zip
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    INNER JOIN dinner_zips dz
        ON c.PRIMARY_LOCATION_POSTAL = dz.zip_code
    WHERE c.RIA_CONTACT_CRD_ID IS NOT NULL
),

-- ============================================================================
-- B. EXCLUSION REFERENCE TABLES
-- ============================================================================
excluded_firms AS (
    SELECT pattern AS firm_pattern
    FROM `savvy-gtm-analytics.ml_features.excluded_firms`
),

excluded_firm_crds AS (
    SELECT firm_crd
    FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

excluded_disposition_crds AS (
    SELECT DISTINCT SAFE_CAST(REGEXP_REPLACE(CAST(FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) AS crd
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE IsDeleted = false AND FA_CRD__c IS NOT NULL
      AND Disposition__c IN ('No Book', 'Book Not Transferable', 'Not a Fit')
),

excluded_closed_recent_crds AS (
    SELECT DISTINCT SAFE_CAST(REGEXP_REPLACE(CAST(FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) AS crd
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE IsDeleted = false AND FA_CRD__c IS NOT NULL AND Status = 'Closed'
      AND DATE(COALESCE(Stage_Entered_Closed__c, LastModifiedDate)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
      AND (Disposition__c IS NULL OR Disposition__c NOT IN (
          'Bad Lead Provided',
          'Bad Contact Info - Uncontacted',
          'Wrong Phone Number - Contacted',
          'No Show/Ghosted'
      ))
),

-- ============================================================================
-- C. SALESFORCE CRDs & LEAD INFO
-- ============================================================================
salesforce_crds AS (
    SELECT DISTINCT
        SAFE_CAST(REGEXP_REPLACE(CAST(FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) AS crd,
        Id AS lead_id
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE FA_CRD__c IS NOT NULL AND IsDeleted = false
),

lead_salesforce_info AS (
    SELECT
        Id AS lead_id,
        Status,
        SGA_Owner_Name__c,
        OwnerId,
        Disposition__c
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE IsDeleted = false
),

-- ============================================================================
-- D. RECYCLABLE LEADS
-- ============================================================================
lead_task_activity AS (
    SELECT
        t.WhoId AS lead_id,
        MAX(GREATEST(
            COALESCE(DATE(t.ActivityDate), DATE('1900-01-01')),
            COALESCE(DATE(t.CompletedDateTime), DATE('1900-01-01')),
            COALESCE(DATE(t.CreatedDate), DATE('1900-01-01'))
        )) AS last_activity_date
    FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
    WHERE t.IsDeleted = false AND t.WhoId IS NOT NULL
      AND (t.Type IN ('Outgoing SMS', 'Incoming SMS')
           OR UPPER(t.Subject) LIKE '%SMS%' OR UPPER(t.Subject) LIKE '%TEXT%'
           OR t.TaskSubtype = 'Call' OR t.Type = 'Call'
           OR UPPER(t.Subject) LIKE '%CALL%' OR t.CallType IS NOT NULL)
    GROUP BY t.WhoId
),

recyclable_lead_ids AS (
    SELECT l.Id AS lead_id,
        SAFE_CAST(REGEXP_REPLACE(CAST(l.FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) AS crd
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
    LEFT JOIN lead_task_activity la ON l.Id = la.lead_id
    WHERE l.IsDeleted = false AND l.FA_CRD__c IS NOT NULL
      AND (l.DoNotCall IS NULL OR l.DoNotCall = false)
      AND (
          (l.Status = 'Nurture' AND (la.last_activity_date IS NULL OR DATE_DIFF(CURRENT_DATE(), la.last_activity_date, DAY) >= 300))
          OR (l.Status = 'Closed' AND (
              (l.Disposition__c IN ('Bad Lead Provided', 'Bad Contact Info - Uncontacted', 'Wrong Phone Number - Contacted', 'No Show/Ghosted')
               AND DATE(COALESCE(l.Stage_Entered_Closed__c, l.LastModifiedDate)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY))
              OR (la.last_activity_date IS NULL OR DATE_DIFF(CURRENT_DATE(), la.last_activity_date, DAY) >= 180)
          ))
      )
),

-- ============================================================================
-- E. ADVISOR EMPLOYMENT HISTORY
-- ============================================================================
advisor_moves AS (
    SELECT
        RIA_CONTACT_CRD_ID AS crd,
        COUNT(DISTINCT PREVIOUS_REGISTRATION_COMPANY_CRD_ID) AS total_firms,
        COUNT(DISTINCT CASE
            WHEN SAFE_CAST(PREVIOUS_REGISTRATION_COMPANY_START_DATE AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 YEAR)
            THEN PREVIOUS_REGISTRATION_COMPANY_CRD_ID END) AS moves_3yr,
        MIN(PREVIOUS_REGISTRATION_COMPANY_START_DATE) AS career_start_date
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
    GROUP BY RIA_CONTACT_CRD_ID
),

-- ============================================================================
-- F. FIRM METRICS
-- ============================================================================
firm_headcount AS (
    SELECT
        SAFE_CAST(PRIMARY_FIRM AS INT64) AS firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) AS current_reps
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
    WHERE PRIMARY_FIRM IS NOT NULL
    GROUP BY PRIMARY_FIRM
),

firm_departures AS (
    SELECT
        SAFE_CAST(PREVIOUS_REGISTRATION_COMPANY_CRD_ID AS INT64) AS firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) AS departures_12mo
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
    WHERE PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NOT NULL
      AND SAFE_CAST(PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    GROUP BY 1
),

firm_arrivals AS (
    SELECT
        SAFE_CAST(PRIMARY_FIRM AS INT64) AS firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) AS arrivals_12mo
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
    WHERE SAFE_CAST(PRIMARY_FIRM_START_DATE AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
      AND PRIMARY_FIRM IS NOT NULL
    GROUP BY 1
),

firm_metrics AS (
    SELECT
        h.firm_crd,
        h.current_reps AS firm_rep_count,
        COALESCE(d.departures_12mo, 0) AS departures_12mo,
        COALESCE(a.arrivals_12mo, 0) AS arrivals_12mo,
        COALESCE(a.arrivals_12mo, 0) - COALESCE(d.departures_12mo, 0) AS firm_net_change_12mo,
        CASE WHEN h.current_reps > 0
             THEN COALESCE(d.departures_12mo, 0) * 100.0 / h.current_reps
             ELSE 0 END AS turnover_pct
    FROM firm_headcount h
    LEFT JOIN firm_departures d ON h.firm_crd = d.firm_crd
    LEFT JOIN firm_arrivals a ON h.firm_crd = a.firm_crd
),

-- ============================================================================
-- G. CAREER CLOCK STATS
-- ============================================================================
career_clock_stats AS (
    SELECT
        eh.RIA_CONTACT_CRD_ID AS advisor_crd,
        COUNT(*) AS cc_completed_jobs,
        AVG(DATE_DIFF(
            SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE),
            SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE AS DATE),
            MONTH
        )) AS cc_avg_prior_tenure_months,
        SAFE_DIVIDE(
            STDDEV(DATE_DIFF(
                SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE),
                SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE AS DATE),
                MONTH
            )),
            AVG(DATE_DIFF(
                SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE),
                SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE AS DATE),
                MONTH
            ))
        ) AS cc_tenure_cv
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
    WHERE eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NOT NULL
      AND eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE IS NOT NULL
      AND SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE) < CURRENT_DATE()
      AND DATE_DIFF(SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE AS DATE),
                    SAFE_CAST(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE AS DATE), MONTH) > 0
    GROUP BY eh.RIA_CONTACT_CRD_ID
    HAVING COUNT(*) >= 2
),

-- ============================================================================
-- H. ENRICH ZIP-MATCHED ADVISORS WITH FINTRX DATA
-- ============================================================================
dinner_enriched AS (
    SELECT
        zma.crd,
        zma.DINNER_CITY,
        zma.dinner_zip,

        -- FinTrx core fields
        c.CONTACT_FIRST_NAME AS first_name,
        c.CONTACT_LAST_NAME AS last_name,
        c.PRIMARY_FIRM_NAME AS firm_name,
        SAFE_CAST(c.PRIMARY_FIRM AS INT64) AS firm_crd,
        c.EMAIL AS email,
        COALESCE(c.MOBILE_PHONE_NUMBER, c.OFFICE_PHONE_NUMBER) AS phone,
        c.PRIMARY_FIRM_START_DATE AS current_firm_start_date,
        c.PRIMARY_FIRM_EMPLOYEE_COUNT AS firm_employee_count,
        c.PRIMARY_LOCATION_POSTAL AS advisor_zip,
        DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS tenure_months,
        DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), YEAR) AS tenure_years,
        c.TITLE_NAME AS job_title,
        c.AGE_RANGE,
        c.PRODUCING_ADVISOR,

        -- Salesforce presence
        CASE WHEN sf.crd IS NULL THEN 'NEW_PROSPECT' ELSE 'IN_SALESFORCE' END AS prospect_type,
        sf.lead_id AS existing_lead_id,
        COALESCE(li.Status = 'Nurture', false) AS is_nurture,
        li.Status AS sf_lead_status,
        li.SGA_Owner_Name__c AS original_sga_owner_name,
        li.OwnerId AS original_sga_owner_id,
        li.Disposition__c AS sf_disposition,
        COALESCE(li.Disposition__c IN ('Bad Contact Info - Uncontacted', 'Wrong Phone Number - Contacted'), false) AS bad_contact_info,

        -- Advisor history
        COALESCE(am.total_firms, 1) AS total_firms,
        COALESCE(am.total_firms, 1) - 1 AS num_prior_firms,
        COALESCE(am.moves_3yr, 0) AS moves_3yr,
        DATE_DIFF(CURRENT_DATE(), am.career_start_date, YEAR) AS industry_tenure_years,
        DATE_DIFF(CURRENT_DATE(), am.career_start_date, MONTH) AS industry_tenure_months,

        -- Firm metrics
        COALESCE(fm.firm_rep_count, SAFE_CAST(c.PRIMARY_FIRM_EMPLOYEE_COUNT AS INT64), 1) AS firm_rep_count,
        COALESCE(fm.arrivals_12mo, 0) AS firm_arrivals_12mo,
        COALESCE(fm.departures_12mo, 0) AS firm_departures_12mo,
        COALESCE(fm.firm_net_change_12mo, 0) AS firm_net_change_12mo,
        COALESCE(fm.turnover_pct, 0) AS firm_turnover_pct,

        -- Wirehouse flag
        CASE WHEN ef_check.firm_pattern IS NOT NULL THEN 1 ELSE 0 END AS is_wirehouse,

        -- Certifications
        CASE WHEN c.CONTACT_BIO LIKE '%CFP%' OR c.TITLE_NAME LIKE '%CFP%' THEN 1 ELSE 0 END AS has_cfp,
        CASE WHEN c.REP_LICENSES LIKE '%Series 65%' AND c.REP_LICENSES NOT LIKE '%Series 7%' THEN 1 ELSE 0 END AS has_series_65_only,
        CASE WHEN c.REP_LICENSES LIKE '%Series 7%' THEN 1 ELSE 0 END AS has_series_7,
        CASE WHEN c.CONTACT_BIO LIKE '%CFA%' OR c.TITLE_NAME LIKE '%CFA%' THEN 1 ELSE 0 END AS has_cfa,

        -- HV wealth title
        CASE WHEN (
            UPPER(c.TITLE_NAME) LIKE '%WEALTH MANAGER%'
            OR UPPER(c.TITLE_NAME) LIKE '%DIRECTOR%WEALTH%'
            OR UPPER(c.TITLE_NAME) LIKE '%SENIOR WEALTH ADVISOR%'
        ) THEN 1 ELSE 0 END AS is_hv_wealth_title,

        -- LinkedIn
        CASE
            WHEN TRIM(COALESCE(c.LINKEDIN_PROFILE_URL, '')) = '' THEN NULL
            WHEN UPPER(TRIM(COALESCE(c.LINKEDIN_PROFILE_URL, ''))) = 'NULL' THEN NULL
            ELSE TRIM(c.LINKEDIN_PROFILE_URL)
        END AS linkedin_url,
        CASE
            WHEN TRIM(COALESCE(c.LINKEDIN_PROFILE_URL, '')) = '' THEN 0
            WHEN UPPER(TRIM(COALESCE(c.LINKEDIN_PROFILE_URL, ''))) = 'NULL' THEN 0
            ELSE 1
        END AS has_linkedin,

        -- Avg account size & practice maturity
        COALESCE(fas.avg_account_size, 0) AS avg_account_size,
        COALESCE(fas.practice_maturity, 'UNKNOWN') AS practice_maturity,

        -- Portable custodian
        COALESCE(fc.has_portable_custodian, 0) AS has_portable_custodian,

        -- Discretionary ratio
        fd.discretionary_ratio,

        -- Career Clock
        ccs.cc_completed_jobs,
        ccs.cc_avg_prior_tenure_months,
        ccs.cc_tenure_cv,
        SAFE_DIVIDE(
            SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64),
            SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64)
        ) AS cc_pct_through_cycle,
        CASE
            WHEN ccs.cc_tenure_cv IS NULL THEN 'No_Pattern'
            WHEN ccs.cc_tenure_cv < 0.3 THEN 'Clockwork'
            WHEN ccs.cc_tenure_cv < 0.5 THEN 'Semi_Predictable'
            WHEN ccs.cc_tenure_cv < 0.8 THEN 'Variable'
            ELSE 'Chaotic'
        END AS cc_career_pattern,
        CASE
            WHEN ccs.cc_tenure_cv IS NULL THEN 'No_Pattern'
            WHEN ccs.cc_tenure_cv >= 0.5 THEN 'Unpredictable'
            WHEN SAFE_DIVIDE(
                SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64),
                SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64)
            ) < 0.7 THEN 'Too_Early'
            WHEN SAFE_DIVIDE(
                SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64),
                SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64)
            ) BETWEEN 0.7 AND 1.3 THEN 'In_Window'
            ELSE 'Overdue'
        END AS cc_cycle_status,
        CASE WHEN ccs.cc_tenure_cv < 0.5
             AND SAFE_DIVIDE(
                 SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64),
                 SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64)
             ) BETWEEN 0.7 AND 1.3
        THEN 1 ELSE 0 END AS cc_is_in_move_window,
        CASE WHEN ccs.cc_tenure_cv < 0.5
             AND SAFE_DIVIDE(
                 SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64),
                 SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64)
             ) < 0.7
        THEN 1 ELSE 0 END AS cc_is_too_early,
        CASE
            WHEN ccs.cc_tenure_cv < 0.5 AND ccs.cc_avg_prior_tenure_months IS NOT NULL
            THEN GREATEST(0, CAST(
                SAFE_CAST(ccs.cc_avg_prior_tenure_months AS FLOAT64) * 0.7
                - SAFE_CAST(DATE_DIFF(CURRENT_DATE(), SAFE_CAST(c.PRIMARY_FIRM_START_DATE AS DATE), MONTH) AS FLOAT64)
              AS INT64))
            ELSE NULL
        END AS cc_months_until_window,

        -- Exclusion flags
        CASE WHEN ef_check.firm_pattern IS NOT NULL THEN TRUE ELSE FALSE END AS excl_firm_name,
        CASE WHEN ec_check.firm_crd IS NOT NULL THEN TRUE ELSE FALSE END AS excl_firm_crd,
        CASE WHEN ed_check.crd IS NOT NULL THEN TRUE ELSE FALSE END AS excl_disposition,
        CASE WHEN ecl_check.crd IS NOT NULL THEN TRUE ELSE FALSE END AS excl_closed_recent,
        CASE WHEN c.AGE_RANGE IN ('70-74', '75-79', '80-84', '85-89', '90-94', '95-99') THEN TRUE ELSE FALSE END AS excl_age_over_70,
        CASE WHEN COALESCE(LOWER(TRIM(CAST(c.PRODUCING_ADVISOR AS STRING))), '') != 'true' THEN TRUE ELSE FALSE END AS excl_not_producing,
        CASE WHEN c.PRIMARY_FIRM_START_DATE IS NULL OR c.PRIMARY_FIRM_NAME IS NULL OR c.PRIMARY_FIRM IS NULL THEN TRUE ELSE FALSE END AS excl_missing_data,
        CASE WHEN (LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_CRIMINAL AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_TERMINATION AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_INVESTIGATION AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_CIVIL_EVENT AS STRING))) = 'true'
              OR LOWER(TRIM(CAST(c.CONTACT_HAS_DISCLOSED_BOND AS STRING))) = 'true')
        THEN TRUE ELSE FALSE END AS excl_disclosure,
        CASE WHEN (
            UPPER(c.TITLE_NAME) LIKE '%FINANCIAL SOLUTIONS ADVISOR%'
            OR UPPER(c.TITLE_NAME) LIKE '%PARAPLANNER%'
            OR UPPER(c.TITLE_NAME) LIKE '%ASSOCIATE ADVISOR%'
            OR UPPER(c.TITLE_NAME) LIKE '%ASSOCIATE FINANCIAL PLANNER%'
            OR UPPER(c.TITLE_NAME) LIKE '%ASSOCIATE WEALTH ADVISOR%'
            OR UPPER(c.TITLE_NAME) LIKE '%OPERATIONS%'
            OR UPPER(c.TITLE_NAME) LIKE '%WHOLESALER%'
            OR UPPER(c.TITLE_NAME) LIKE '%COMPLIANCE%'
            OR UPPER(c.TITLE_NAME) LIKE '%ASSISTANT%'
            OR UPPER(c.TITLE_NAME) LIKE '%INSURANCE AGENT%'
            OR UPPER(c.TITLE_NAME) LIKE '%INSURANCE%'
            OR UPPER(c.TITLE_NAME) LIKE '%BRANCH MANAGER%'
            OR UPPER(c.TITLE_NAME) LIKE '%CHIEF FINANCIAL OFFICER%'
            OR UPPER(c.TITLE_NAME) LIKE '%CFO%'
            OR UPPER(c.TITLE_NAME) LIKE '%CHIEF INVESTMENT OFFICER%'
            OR UPPER(c.TITLE_NAME) LIKE '%CIO%'
            OR UPPER(c.TITLE_NAME) LIKE '%VICE PRESIDENT%'
            OR UPPER(c.TITLE_NAME) LIKE '%VP %'
        ) THEN TRUE ELSE FALSE END AS excl_title,
        CASE WHEN COALESCE(SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64), 0) < 60
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
        THEN TRUE ELSE FALSE END AS excl_recent_promotee,
        CASE WHEN fd.discretionary_ratio IS NOT NULL AND fd.discretionary_ratio < 0.50 THEN TRUE ELSE FALSE END AS excl_low_discretionary,
        CASE WHEN COALESCE(fm.turnover_pct, 0) >= 100 THEN TRUE ELSE FALSE END AS excl_high_turnover,
        CASE WHEN sf.crd IS NOT NULL
             AND li.Status IS NOT NULL
             AND li.Status NOT IN ('Closed', 'Nurture')
             AND sf.lead_id NOT IN (SELECT lead_id FROM recyclable_lead_ids)
        THEN TRUE ELSE FALSE END AS excl_active_in_salesforce

    FROM zip_matched_advisors zma
    INNER JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
        ON zma.crd = c.RIA_CONTACT_CRD_ID
    LEFT JOIN salesforce_crds sf ON zma.crd = sf.crd
    LEFT JOIN lead_salesforce_info li ON sf.lead_id = li.lead_id
    LEFT JOIN advisor_moves am ON zma.crd = am.crd
    LEFT JOIN firm_metrics fm ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = fm.firm_crd
    LEFT JOIN excluded_firms ef_check ON UPPER(c.PRIMARY_FIRM_NAME) LIKE ef_check.firm_pattern
    LEFT JOIN excluded_firm_crds ec_check ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = ec_check.firm_crd
    LEFT JOIN excluded_disposition_crds ed_check ON zma.crd = ed_check.crd
    LEFT JOIN excluded_closed_recent_crds ecl_check ON zma.crd = ecl_check.crd
    LEFT JOIN career_clock_stats ccs ON zma.crd = ccs.advisor_crd
    LEFT JOIN (
        SELECT
            CRD_ID AS firm_crd,
            SAFE_DIVIDE(SAFE_CAST(TOTAL_AUM AS FLOAT64), SAFE_CAST(TOTAL_ACCOUNTS AS FLOAT64)) AS avg_account_size,
            CASE
                WHEN SAFE_DIVIDE(SAFE_CAST(TOTAL_AUM AS FLOAT64), SAFE_CAST(TOTAL_ACCOUNTS AS FLOAT64)) >= 250000 THEN 'ESTABLISHED'
                WHEN SAFE_DIVIDE(SAFE_CAST(TOTAL_AUM AS FLOAT64), SAFE_CAST(TOTAL_ACCOUNTS AS FLOAT64)) IS NULL THEN 'UNKNOWN'
                ELSE 'GROWTH_STAGE'
            END AS practice_maturity
        FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
        WHERE SAFE_CAST(TOTAL_AUM AS FLOAT64) > 0 AND SAFE_CAST(TOTAL_ACCOUNTS AS FLOAT64) > 0
    ) fas ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = fas.firm_crd
    LEFT JOIN (
        SELECT
            CRD_ID AS firm_crd,
            CASE WHEN UPPER(CUSTODIAN_PRIMARY_BUSINESS_NAME) LIKE '%SCHWAB%'
                      OR UPPER(CUSTODIAN_PRIMARY_BUSINESS_NAME) LIKE '%CHARLES%'
                      OR UPPER(CUSTODIAN_PRIMARY_BUSINESS_NAME) LIKE '%FIDELITY%'
                      OR UPPER(CUSTODIAN_PRIMARY_BUSINESS_NAME) LIKE '%PERSHING%'
                 THEN 1 ELSE 0
            END AS has_portable_custodian
        FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
    ) fc ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = fc.firm_crd
    LEFT JOIN (
        SELECT
            CRD_ID AS firm_crd,
            SAFE_DIVIDE(SAFE_CAST(DISCRETIONARY_AUM AS FLOAT64), SAFE_CAST(TOTAL_AUM AS FLOAT64)) AS discretionary_ratio
        FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
    ) fd ON SAFE_CAST(c.PRIMARY_FIRM AS INT64) = fd.firm_crd
),

-- ============================================================================
-- I. BUILD EXCLUSION REASON STRING
-- ============================================================================
dinner_with_exclusions AS (
    SELECT
        dinner_enriched.*,
        CASE
            WHEN excl_firm_name OR excl_firm_crd THEN 'EXCLUDED'
            WHEN excl_disposition THEN 'EXCLUDED'
            WHEN excl_closed_recent THEN 'EXCLUDED'
            WHEN excl_age_over_70 THEN 'EXCLUDED'
            WHEN excl_not_producing THEN 'EXCLUDED'
            WHEN excl_missing_data THEN 'EXCLUDED'
            WHEN excl_disclosure THEN 'EXCLUDED'
            WHEN excl_title THEN 'EXCLUDED'
            WHEN excl_recent_promotee THEN 'EXCLUDED'
            WHEN excl_low_discretionary THEN 'EXCLUDED'
            WHEN excl_high_turnover THEN 'EXCLUDED'
            WHEN excl_active_in_salesforce THEN 'EXCLUDED'
            ELSE 'SCORABLE'
        END AS scoring_status,
        CONCAT(
            CASE WHEN excl_firm_name THEN CONCAT('Excluded firm name (', COALESCE(firm_name, 'N/A'), '); ') ELSE '' END,
            CASE WHEN excl_firm_crd THEN CONCAT('Excluded firm CRD (', CAST(COALESCE(firm_crd, 0) AS STRING), '); ') ELSE '' END,
            CASE WHEN excl_disposition THEN 'Lead disposition (No Book / Book Not Transferable / Not a Fit); ' ELSE '' END,
            CASE WHEN excl_closed_recent THEN 'Closed within 365 days with non-recyclable disposition; ' ELSE '' END,
            CASE WHEN excl_age_over_70 THEN CONCAT('Age over 70 (', COALESCE(AGE_RANGE, 'unknown'), '); ') ELSE '' END,
            CASE WHEN excl_not_producing THEN 'Not a producing advisor; ' ELSE '' END,
            CASE WHEN excl_missing_data THEN 'Missing firm start date, firm name, or firm CRD; ' ELSE '' END,
            CASE WHEN excl_disclosure THEN 'Regulatory/legal disclosure on record; ' ELSE '' END,
            CASE WHEN excl_title THEN CONCAT('Excluded title (', COALESCE(job_title, 'N/A'), '); ') ELSE '' END,
            CASE WHEN excl_recent_promotee THEN 'Recent promotee (<5yr tenure + mid/senior title); ' ELSE '' END,
            CASE WHEN excl_low_discretionary THEN CONCAT('Low discretionary ratio (', CAST(ROUND(COALESCE(discretionary_ratio, 0) * 100, 1) AS STRING), '%); ') ELSE '' END,
            CASE WHEN excl_high_turnover THEN CONCAT('Firm turnover too high (', CAST(ROUND(firm_turnover_pct, 1) AS STRING), '%); ') ELSE '' END,
            CASE WHEN excl_active_in_salesforce THEN CONCAT('Active in Salesforce (Status: ', COALESCE(sf_lead_status, 'unknown'), '); ') ELSE '' END
        ) AS exclusion_reasons
    FROM dinner_enriched
),

-- ============================================================================
-- J. V4 ML SCORES
-- ============================================================================
dinner_with_v4 AS (
    SELECT
        dwe.*,
        COALESCE(v4.v4_score, 0.5) AS v4_score,
        COALESCE(v4.v4_percentile, 50) AS v4_percentile,
        COALESCE(v4.v4_deprioritize, FALSE) AS v4_deprioritize,
        v4.shap_top1_feature,
        v4.shap_top2_feature,
        v4.shap_top3_feature,
        v4.v4_narrative
    FROM dinner_with_exclusions dwe
    LEFT JOIN `savvy-gtm-analytics.ml_features.v4_prospect_scores` v4
        ON dwe.crd = v4.crd
),

-- ============================================================================
-- K. APPLY TIER LOGIC (V3.7.0 rules)
-- ============================================================================
dinner_tiered AS (
    SELECT
        dv.*,

        CASE WHEN scoring_status = 'SCORABLE' AND dv.v4_percentile < 20
             THEN TRUE ELSE FALSE END AS excl_v4_bottom_20,

        -- Score tier
        CASE
            WHEN scoring_status != 'SCORABLE' THEN NULL
            WHEN dv.v4_percentile < 20 THEN NULL

            WHEN cc_is_in_move_window = 1 AND tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0
            THEN 'TIER_0A_PRIME_MOVER_DUE'
            WHEN cc_is_in_move_window = 1 AND firm_rep_count <= 10 AND is_wirehouse = 0
            THEN 'TIER_0B_SMALL_FIRM_DUE'
            WHEN cc_is_in_move_window = 1 AND is_wirehouse = 0
            THEN 'TIER_0C_CLOCKWORK_DUE'

            WHEN has_series_65_only = 1 AND has_portable_custodian = 1 AND firm_rep_count <= 10 AND firm_net_change_12mo <= -3 AND has_cfp = 0 AND is_wirehouse = 0
            THEN 'TIER_1B_PRIME_ZERO_FRICTION'
            WHEN (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years >= 5 AND firm_net_change_12mo < 0 AND has_cfp = 1 AND is_wirehouse = 0)
            THEN 'TIER_1A_PRIME_MOVER_CFP'
            WHEN (((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0)
                  OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0)
                  OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0))
                  AND has_series_65_only = 1)
            THEN 'TIER_1B_PRIME_MOVER_SERIES65'
            WHEN ((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0)
                  OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0)
                  OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0))
            THEN 'TIER_1_PRIME_MOVER'
            WHEN (is_hv_wealth_title = 1 AND firm_net_change_12mo < 0 AND is_wirehouse = 0)
            THEN 'TIER_1F_HV_WEALTH_BLEEDER'
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size BETWEEN 500000 AND 2000000 AND firm_net_change_12mo > -3 AND is_wirehouse = 0)
            THEN 'TIER_1G_ENHANCED_SWEET_SPOT'
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size >= 250000 AND (avg_account_size < 500000 OR avg_account_size > 2000000) AND firm_net_change_12mo > -3 AND is_wirehouse = 0)
            THEN 'TIER_1G_GROWTH_STAGE'
            WHEN (num_prior_firms >= 3 AND industry_tenure_years >= 5)
            THEN 'TIER_2_PROVEN_MOVER'
            WHEN (firm_net_change_12mo BETWEEN -10 AND -1 AND industry_tenure_years >= 5)
            THEN 'TIER_3_MODERATE_BLEEDER'
            WHEN cc_is_too_early = 1 AND firm_net_change_12mo >= -10
            THEN 'TIER_NURTURE_TOO_EARLY'
            ELSE 'STANDARD'
        END AS score_tier,

        -- Priority rank
        CASE
            WHEN scoring_status != 'SCORABLE' OR dv.v4_percentile < 20 THEN 99
            WHEN cc_is_in_move_window = 1 AND tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0 THEN 1
            WHEN cc_is_in_move_window = 1 AND firm_rep_count <= 10 AND is_wirehouse = 0 THEN 2
            WHEN cc_is_in_move_window = 1 AND is_wirehouse = 0 THEN 3
            WHEN has_series_65_only = 1 AND has_portable_custodian = 1 AND firm_rep_count <= 10 AND firm_net_change_12mo <= -3 AND has_cfp = 0 AND is_wirehouse = 0 THEN 4
            WHEN (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years >= 5 AND firm_net_change_12mo < 0 AND has_cfp = 1 AND is_wirehouse = 0) THEN 5
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size BETWEEN 500000 AND 2000000 AND firm_net_change_12mo > -3 AND is_wirehouse = 0) THEN 6
            WHEN (((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0)) AND has_series_65_only = 1) THEN 7
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size >= 250000 AND (avg_account_size < 500000 OR avg_account_size > 2000000) AND firm_net_change_12mo > -3 AND is_wirehouse = 0) THEN 8
            WHEN ((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0)) THEN 9
            WHEN (is_hv_wealth_title = 1 AND firm_net_change_12mo < 0 AND is_wirehouse = 0) THEN 10
            WHEN (num_prior_firms >= 3 AND industry_tenure_years >= 5) THEN 11
            WHEN (firm_net_change_12mo BETWEEN -10 AND -1 AND industry_tenure_years >= 5) THEN 12
            WHEN cc_is_too_early = 1 AND firm_net_change_12mo >= -10 THEN 97
            ELSE 99
        END AS priority_rank,

        -- Expected conversion rate
        CASE
            WHEN scoring_status != 'SCORABLE' OR dv.v4_percentile < 20 THEN NULL
            WHEN cc_is_in_move_window = 1 AND tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0 THEN 0.0559
            WHEN cc_is_in_move_window = 1 AND firm_rep_count <= 10 AND is_wirehouse = 0 THEN 0.0550
            WHEN cc_is_in_move_window = 1 AND is_wirehouse = 0 THEN 0.0507
            WHEN has_series_65_only = 1 AND has_portable_custodian = 1 AND firm_rep_count <= 10 AND firm_net_change_12mo <= -3 AND has_cfp = 0 AND is_wirehouse = 0 THEN 0.1364
            WHEN (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years >= 5 AND firm_net_change_12mo < 0 AND has_cfp = 1 AND is_wirehouse = 0) THEN 0.1000
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size BETWEEN 500000 AND 2000000 AND firm_net_change_12mo > -3 AND is_wirehouse = 0) THEN 0.0909
            WHEN (((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0)) AND has_series_65_only = 1) THEN 0.0549
            WHEN ((tenure_years BETWEEN 1 AND 3 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND firm_rep_count <= 50 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 3 AND firm_rep_count <= 10 AND is_wirehouse = 0) OR (tenure_years BETWEEN 1 AND 4 AND industry_tenure_years BETWEEN 5 AND 15 AND firm_net_change_12mo < 0 AND is_wirehouse = 0)) THEN 0.071
            WHEN (is_hv_wealth_title = 1 AND firm_net_change_12mo < 0 AND is_wirehouse = 0) THEN 0.065
            WHEN (industry_tenure_months BETWEEN 60 AND 180 AND avg_account_size >= 250000 AND (avg_account_size < 500000 OR avg_account_size > 2000000) AND firm_net_change_12mo > -3 AND is_wirehouse = 0) THEN 0.0508
            WHEN (num_prior_firms >= 3 AND industry_tenure_years >= 5) THEN 0.052
            WHEN (firm_net_change_12mo BETWEEN -10 AND -1 AND industry_tenure_years >= 5) THEN 0.044
            WHEN cc_is_too_early = 1 AND firm_net_change_12mo >= -10 THEN 0.0372
            ELSE 0.025
        END AS expected_conversion_rate

    FROM dinner_with_v4 dv
)

-- ============================================================================
-- FINAL OUTPUT
-- ============================================================================
SELECT
    -- Dinner event info
    DINNER_CITY,
    dinner_zip AS advisor_zip,

    -- Scoring result
    CASE
        WHEN scoring_status = 'EXCLUDED' THEN 'EXCLUDED'
        WHEN excl_v4_bottom_20 THEN 'EXCLUDED'
        WHEN score_tier IS NULL THEN 'EXCLUDED'
        ELSE score_tier
    END AS final_tier,

    CASE
        WHEN scoring_status = 'EXCLUDED' THEN exclusion_reasons
        WHEN excl_v4_bottom_20 THEN CONCAT('V4 ML model bottom 20% (percentile: ', CAST(v4_percentile AS STRING), '); ')
        WHEN score_tier IS NULL THEN 'No tier assigned'
        ELSE ''
    END AS exclusion_reason,

    CASE
        WHEN scoring_status = 'EXCLUDED' OR excl_v4_bottom_20 OR score_tier IS NULL THEN 'EXCLUDED'
        ELSE 'SCORED'
    END AS status,

    priority_rank,
    expected_conversion_rate,
    ROUND(COALESCE(expected_conversion_rate, 0) * 100, 2) AS expected_rate_pct,

    -- Advisor details
    crd,
    first_name,
    last_name,
    email,
    phone,
    linkedin_url,
    has_linkedin,
    job_title,
    prospect_type,
    CASE
        WHEN prospect_type = 'NEW_PROSPECT' THEN 'New - Not in Salesforce'
        WHEN existing_lead_id IN (SELECT lead_id FROM recyclable_lead_ids) THEN 'Recyclable'
        ELSE CONCAT('In Salesforce (', COALESCE(sf_lead_status, 'unknown'), ')')
    END AS salesforce_status,
    is_nurture,
    original_sga_owner_name,
    bad_contact_info,

    -- Firm details
    firm_name,
    firm_crd,
    firm_rep_count,
    firm_net_change_12mo,
    firm_arrivals_12mo,
    firm_departures_12mo,
    ROUND(firm_turnover_pct, 1) AS firm_turnover_pct,
    is_wirehouse,

    -- Tenure & experience
    tenure_months,
    tenure_years,
    industry_tenure_years,
    num_prior_firms,
    moves_3yr,
    AGE_RANGE AS age_range,

    -- Certifications
    has_cfp,
    has_series_65_only,
    has_series_7,
    has_cfa,
    is_hv_wealth_title,
    practice_maturity,

    -- V4 ML scoring
    ROUND(v4_score, 4) AS v4_score,
    v4_percentile,
    shap_top1_feature AS v4_top1_feature,
    shap_top2_feature AS v4_top2_feature,
    shap_top3_feature AS v4_top3_feature,
    v4_narrative,

    -- Career Clock
    cc_career_pattern,
    cc_cycle_status,
    ROUND(cc_pct_through_cycle, 2) AS cc_pct_through_cycle,
    cc_months_until_window,
    cc_is_in_move_window,
    cc_is_too_early,

    CURRENT_TIMESTAMP() AS generated_at

FROM dinner_tiered
ORDER BY
    DINNER_CITY,
    CASE WHEN scoring_status = 'EXCLUDED' OR excl_v4_bottom_20 OR score_tier IS NULL THEN 1 ELSE 0 END,
    priority_rank,
    v4_percentile DESC;
