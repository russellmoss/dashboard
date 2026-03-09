# Data Verifier Findings — Weekly Goals vs. Actuals

## Summary

All 7 actuals metrics have verified BigQuery data sources. No view modifications needed.

---

## 1. MQL Actuals ✅

**Source:** `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
**Date field:** `mql_stage_entered_ts` (TIMESTAMP — maps to `Stage_Entered_Call_Scheduled__c` on Lead)
**SGA field:** `SGA_Owner_Name__c`
**Flag field:** `is_mql` (INTEGER, 1/0)

**Query pattern:**
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as mql_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE mql_stage_entered_ts >= @week_start AND mql_stage_entered_ts < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8):** Brian O'Hara: 42, Perry Kalmeta: 24, Russell Armitage: 16, Jacqueline Tully: 14 (152 total across 15 SGAs)

**Note:** MQL = "Call Scheduled" stage in Salesforce. The `mql_stage_entered_ts` is the timestamp when the lead entered this stage.

---

## 2. SQL Actuals ✅

**Source:** `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
**Date field:** `converted_date_raw` (DATE — Lead.ConvertedDate)
**SGA field:** `SGA_Owner_Name__c`
**Flag field:** `is_sql` (INTEGER, 1/0)

**Query pattern:**
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sql_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE converted_date_raw >= @week_start AND converted_date_raw < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8):** Marisa Saucedo: 4, Jacqueline Tully: 4, Russell Armitage: 4 (28 total across 10 SGAs)

**Note:** SQL = Lead converted to Opportunity (IsConverted = TRUE). `converted_date_raw` is a DATE not TIMESTAMP.

---

## 3. SQO Actuals ✅

**Source:** `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
**Date field:** `Date_Became_SQO__c` (TIMESTAMP)
**SGA field:** `SGA_Owner_Name__c`
**Flag field:** `is_sqo` (INTEGER, 1/0 — derived from `SQL__c = 'Yes'` on Opportunity)

**Query pattern:**
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE Date_Became_SQO__c >= @week_start AND Date_Became_SQO__c < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8):** Ryan Crandall: 6, Russell Armitage: 6, Amy Waller: 5 (43 total across 12 SGAs)

---

## 4. Initial Calls Actuals ✅

**Source:** `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
**Date field:** `Initial_Call_Scheduled_Date__c` (DATE — on the Lead/Opp record, not the Task)
**SGA field:** `SGA_Owner_Name__c`

**Query pattern (DISTINCT to avoid task-level duplication):**
```sql
SELECT SGA_Owner_Name__c,
  COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)) as initial_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE Initial_Call_Scheduled_Date__c >= @week_start
  AND Initial_Call_Scheduled_Date__c < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8):** Russell Armitage: 7, Brian O'Hara: 7, Marisa Saucedo: 5 (63 total across 15 SGAs)

**Population rate:** 268/14,433 leads (1.9%) have Initial_Call_Scheduled_Date__c — this is expected since only leads that progress to a scheduled call get this date.

**Next-week lookahead works:** Query with date range 3/9–3/15 returns future scheduled calls (Brian O'Hara: 14, Perry Kalmeta: 14, etc.)

**IMPORTANT:** Must use `COUNT(DISTINCT ...)` because vw_sga_activity_performance is at the Task level (many tasks per lead). Without DISTINCT, counts inflate ~3x.

---

## 5. Qualification Calls Actuals ✅

**Source:** `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
**Date field:** `Qualification_Call_Date__c` (DATE)
**SGA field:** `SGA_Owner_Name__c`
**SGM field:** `sgm_name` (populated — links qual call to the SGM)

**Query pattern:**
```sql
SELECT SGA_Owner_Name__c,
  COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)) as qual_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE Qualification_Call_Date__c >= @week_start
  AND Qualification_Call_Date__c < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8):** Craig Suchodolski: 3, Ryan Crandall: 3, Russell Armitage: 3 (18 total across 9 SGAs)

**Population rate:** 70/14,433 leads (0.5%) have Qualification_Call_Date__c — expected since few leads reach this stage.

**SGM linkage confirmed:** `sgm_name` field is populated on qualification call records (e.g., Jade Bingham, Erin Pearson, Bryan Belville, etc.)

---

## 6. Leads Sourced ✅

**Source:** `savvy-gtm-analytics.SavvyGTMData.Lead` (direct table)
**Date field:** `CreatedDate` (TIMESTAMP)
**SGA field:** `SGA_Owner_Name__c`
**Self-sourced filter:** `Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')`

**Query patterns:**

Total leads sourced:
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as leads_sourced
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE CreatedDate >= @week_start AND CreatedDate < @week_end
GROUP BY SGA_Owner_Name__c
```

Self-sourced only:
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as self_sourced
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND CreatedDate >= @week_start AND CreatedDate < @week_end
GROUP BY SGA_Owner_Name__c
```

**Sample (3/2–3/8) self-sourced:** Eleni Stefanopoulos: 918, Holly Huffman: 161, Channing Guyer: 102 (1,534 total)

**Note:** Lead table includes non-SGA owners (e.g., "Savvy Operations"). Filter to active SGAs using JOIN to User table or use vw_sga_funnel which already filters.

---

## 7. Leads Contacted ✅

**Source:** `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
**Date field:** `stage_entered_contacting__c` (TIMESTAMP)
**SGA field:** `SGA_Owner_Name__c`

**Query patterns:**

All leads contacted:
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as leads_contacted
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE stage_entered_contacting__c >= @week_start AND stage_entered_contacting__c < @week_end
GROUP BY SGA_Owner_Name__c
```

Self-sourced contacted (requires Lead table for Final_Source__c):
```sql
SELECT l.SGA_Owner_Name__c, COUNT(*) as self_sourced_contacted
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND l.Stage_Entered_Contacting__c >= @week_start
  AND l.Stage_Entered_Contacting__c < @week_end
GROUP BY l.SGA_Owner_Name__c
```

**Sample (3/2–3/8) all contacted:** Russell Armitage: 901, Channing Guyer: 648, Marisa Saucedo: 584 (4,468 total)
**Sample (3/2–3/8) self-sourced contacted:** Russell Armitage: 309, Eleni Stefanopoulos: 227, Holly Huffman: 156

**Note:** Self-sourced contacted query returns "Savvy Operations" (104) — must filter to real SGAs. Use `WHERE SGA_Owner_Name__c != 'Savvy Operations'` or JOIN to User table.

---

## 8. Data Quality Notes

### SGA Name Consistency
- `SGA_Owner_Name__c` is consistent across `vw_sga_funnel`, `vw_sga_activity_performance`, and the Lead table
- Both views filter to active SGA/SGM users via JOIN to `SavvyGTMData.User` WHERE `IsSGA__c = TRUE AND IsActive = TRUE`
- Direct Lead table queries need explicit SGA filtering

### Edge Cases
- **"Savvy Operations"** and **"Savvy Marketing"** appear as SGA_Owner_Name__c on some leads — must be excluded
- `vw_sga_funnel` handles this: replaces "Savvy Marketing" with opp-level SGA and filters to active users
- Direct Lead table queries don't filter — add WHERE clause or JOIN

### Date Type Differences
| Field | Type | Notes |
|-------|------|-------|
| `mql_stage_entered_ts` | TIMESTAMP | Compare with TIMESTAMP |
| `converted_date_raw` | DATE | Compare with DATE |
| `Date_Became_SQO__c` | TIMESTAMP | Compare with TIMESTAMP |
| `Initial_Call_Scheduled_Date__c` | DATE | Compare with DATE |
| `Qualification_Call_Date__c` | DATE | Compare with DATE |
| `CreatedDate` (Lead) | TIMESTAMP | Compare with TIMESTAMP |
| `stage_entered_contacting__c` | TIMESTAMP | Compare with TIMESTAMP |

### View Selection Guide
| Metric | Best Source | Why |
|--------|------------|-----|
| MQL, SQL, SQO | `vw_sga_funnel` | Pre-calculated flags, active SGA filter, combined Lead+Opp |
| Initial Calls, Qual Calls | `vw_sga_activity_performance` | Has call date fields + task-level detail for drilldown |
| Leads Sourced | `Lead` table direct | Need `Final_Source__c` which isn't in funnel views |
| Leads Contacted (all) | `vw_sga_funnel` | Has `stage_entered_contacting__c` + active SGA filter |
| Leads Contacted (self-sourced) | `Lead` table direct | Need `Final_Source__c` + `Stage_Entered_Contacting__c` |

---

## 9. Drilldown Data Availability

All metrics support drilldown to individual records:

- **MQL/SQL/SQO drilldown:** `vw_sga_funnel` has `unique_id`, `Full_prospect_id__c`, `Full_Opportunity_ID__c`, plus channel/source fields
- **Initial/Qual call drilldown:** `vw_sga_activity_performance` has `Full_prospect_id__c`, `Full_Opportunity_ID__c`, `advisor_name`, `Prospect_Name`, `Opp_Name`, `StageName`, `TOF_Stage`, `sgm_name`
- **Leads sourced drilldown:** Lead table has full lead details (Name, Company, Email, Phone, etc.)
- **Leads contacted drilldown:** Lead table has `Stage_Entered_Contacting__c` + full lead details

---

## 10. No View Modifications Needed ✅

All required fields exist in current views/tables. No BigQuery view changes are blockers.
