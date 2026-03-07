# Claude Code Prompt — Pull Detailed Closed-Lost Firm Change Table

Run this query in BigQuery via MCP and export the full results to a CSV file at:
`C:\Users\russe\Documents\Dashboard\closed_lost_firm_movers_detail.csv`

**DO NOT edit any codebase files. Only query BQ and write the CSV.**

## Query

```sql
SELECT
  o.Id AS opportunity_id,
  o.Name AS opportunity_name,
  o.FA_CRD__c AS crd,
  o.Firm_Name__c AS firm_at_recruitment,
  o.Date_Became_SQO__c AS sqo_date,
  o.CloseDate AS closed_lost_date,
  o.Closed_Lost_Reason__c AS closed_lost_reason,
  o.StageName AS stage_name,
  o.Opportunity_Owner_Name__c AS opportunity_owner,
  f.PRIMARY_FIRM_NAME AS moved_to_firm,
  SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) AS new_firm_start_date,
  DATE_DIFF(SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE), o.CloseDate, DAY) AS days_closed_lost_to_move,
  ROUND(DATE_DIFF(SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE), o.CloseDate, DAY) / 30.44) AS months_closed_lost_to_move
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
  ON o.FA_CRD__c = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
WHERE o.SQL__c = 'Yes'
  AND o.StageName = 'Closed Lost'
  AND o.FA_CRD__c IS NOT NULL
  AND SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) > o.CloseDate
ORDER BY months_closed_lost_to_move ASC;
```

If the `Id` column doesn't work for the Salesforce Opportunity ID, check with:
```sql
SELECT column_name FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS` WHERE table_name = 'Opportunity' AND LOWER(column_name) LIKE '%id%' LIMIT 20;
```
Then substitute the correct Opportunity ID field and re-run.

Similarly, if `Date_Became_SQO__c` fails, check INFORMATION_SCHEMA for the correct column name.

## Output

1. Write ALL rows to the CSV at the path above. Do not truncate.
2. After writing the CSV, tell me the total row count and confirm the columns present.
3. Do not create any other files.
