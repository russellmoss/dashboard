# Claude Code Prompt — Create and Deploy vw_lost_to_competition

You are creating a BigQuery view and saving its SQL definition locally. Do both.

**DO NOT edit any existing codebase files. Only create the view SQL file and deploy the view to BQ.**

## Step 1: Create the SQL file

Save the following view definition to: `C:\Users\russe\Documents\Dashboard\views\vw_lost_to_competition.sql`

```sql
CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition` AS

WITH closed_lost_sqos AS (
  SELECT
    o.Id AS opportunity_id,
    o.Name AS opportunity_name,
    o.FA_CRD__c AS crd,
    o.Firm_Name__c AS firm_at_recruitment,
    o.Date_Became_SQO__c AS sqo_date,
    o.CloseDate AS closed_lost_date,
    o.Closed_Lost_Reason__c AS closed_lost_reason,
    o.Closed_Lost_Details__c AS closed_lost_details,
    o.StageName AS stage_name,
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
    SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE) AS current_firm_start_date,
    SAFE.PARSE_DATE('%Y-%m-%d', LATEST_REGISTERED_EMPLOYMENT_END_DATE) AS last_firm_end_date
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
)

SELECT
  cls.opportunity_id,
  cls.opportunity_name,
  cls.crd,
  cls.firm_at_recruitment,
  cls.sqo_date,
  cls.closed_lost_date,
  cls.closed_lost_reason,
  cls.closed_lost_details,
  cls.opportunity_owner,
  ft.current_firm AS moved_to_firm,
  ft.current_firm_start_date AS new_firm_start_date,
  ft.last_firm_end_date,
  DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) AS days_to_move,
  ROUND(DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) / 30.44) AS months_to_move,
  CASE
    WHEN ft.current_firm_start_date IS NULL THEN 'No FinTrx Match'
    WHEN ft.current_firm_start_date <= cls.closed_lost_date THEN 'No Firm Change After Close'
    WHEN ROUND(DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) / 30.44) <= 3 THEN 'Moved: 0-3 Months'
    WHEN ROUND(DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) / 30.44) <= 6 THEN 'Moved: 4-6 Months'
    WHEN ROUND(DATE_DIFF(ft.current_firm_start_date, cls.closed_lost_date, DAY) / 30.44) <= 12 THEN 'Moved: 7-12 Months'
    ELSE 'Moved: 12+ Months'
  END AS move_speed_bucket,
  CASE
    WHEN ft.current_firm_start_date IS NOT NULL
      AND ft.current_firm_start_date > cls.closed_lost_date THEN TRUE
    ELSE FALSE
  END AS did_change_firms
FROM closed_lost_sqos cls
LEFT JOIN fintrix_current ft
  ON cls.crd = ft.crd;
```

If any column fails (e.g., `Id`, `Closed_Lost_Details__c`), query INFORMATION_SCHEMA to find the correct name, fix the SQL, and update the saved file before deploying.

## Step 2: Deploy the view to BigQuery

Run the CREATE OR REPLACE VIEW statement from the SQL file via MCP against BigQuery. If it succeeds, move to validation. If it fails due to column names, fix the SQL file and retry.

## Step 3: Validate

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNTIF(did_change_firms = TRUE) AS firm_changers,
  COUNTIF(did_change_firms = FALSE) AS stayed_put
FROM `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`;
```

```sql
SELECT
  did_change_firms,
  move_speed_bucket,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

```sql
SELECT
  opportunity_id,
  opportunity_name,
  firm_at_recruitment,
  closed_lost_date,
  closed_lost_reason,
  moved_to_firm,
  months_to_move
FROM `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`
WHERE did_change_firms = TRUE
ORDER BY months_to_move ASC
LIMIT 10;
```

## Step 4: Report back

Tell me:
1. Confirm the view is live at `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`
2. Confirm the SQL file is saved at `C:\Users\russe\Documents\Dashboard\views\vw_lost_to_competition.sql`
3. Total rows, firm changers, stayed put counts
4. Any column adjustments you had to make
5. Top 5 fastest movers as a sanity check
