CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition` AS

WITH closed_lost_sqos AS (
  SELECT
    o.Id AS opportunity_id,
    o.Name AS opportunity_name,
    o.FA_CRD__c AS crd,
    o.Firm_Name__c AS firm_at_recruitment,
    o.Date_Became_SQO__c AS sqo_date,
    DATE(o.Stage_Entered_Closed__c) AS closed_lost_date,
    o.Closed_Lost_Reason__c AS closed_lost_reason,
    o.Closed_Lost_Details__c AS closed_lost_details,
    o.Opportunity_Owner_Name__c AS opportunity_owner
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.SQL__c = 'Yes'
    AND o.StageName = 'Closed Lost'
    AND o.FA_CRD__c IS NOT NULL
),

fintrix_current AS (
  SELECT
    CAST(RIA_CONTACT_CRD_ID AS STRING) AS crd,
    PRIMARY_FIRM_NAME AS current_firm,
    SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE) AS current_firm_start_date
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
)

SELECT
  cls.opportunity_id,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', cls.opportunity_id, '/view') AS sfdc_url,
  cls.opportunity_name,
  cls.crd,
  cls.firm_at_recruitment AS original_firm,
  cls.sqo_date,
  cls.closed_lost_date,
  ft.current_firm_start_date AS new_firm_start_date,
  ROUND(DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) / 30.44) AS months_to_move,
  ft.current_firm AS moved_to_firm,
  cls.closed_lost_reason,
  cls.closed_lost_details
FROM closed_lost_sqos cls
INNER JOIN fintrix_current ft
  ON cls.crd = ft.crd
WHERE ft.current_firm_start_date > cls.closed_lost_date
ORDER BY months_to_move ASC;
