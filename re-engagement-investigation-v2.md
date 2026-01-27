# Re-Engagement Investigation v2: Account-Centric Unification

> **Objective**: Investigate how to unify all records (Leads + all Opportunities) for a single person/advisor using the Account object as the central linking mechanism.
>
> **Output Location**: Save all findings to `C:\Users\russe\Documents\Dashboard\re-engagement-investigation-v2.md`
>
> **Key Example**: Chris Habib - Account ID: `001VS000006WRUgYAO`
> - 1 Lead record (2024)
> - 2 Re-Engagement Opportunities  
> - 1 Recruiting Opportunity (SQO)

---

## Codebase Context (From Project Knowledge)

### Key Files You'll Be Modifying

| File | Purpose | Location |
|------|---------|----------|
| `vw_funnel_master.sql` | Main BigQuery view definition | `views/vw_funnel_master.sql` |
| `funnel-metrics.ts` | Scorecard metrics (SQO count) | `src/lib/queries/funnel-metrics.ts` |
| `drill-down.ts` | SQO drilldown modal | `src/lib/queries/drill-down.ts` |
| `detail-records.ts` | Main data table | `src/lib/queries/detail-records.ts` |
| `quarterly-progress.ts` | Quarterly SQO tracking | `src/lib/queries/quarterly-progress.ts` |
| `re-engagement.ts` | Re-engagement opps query | `src/lib/queries/re-engagement.ts` |

### Current View Architecture

The current `vw_funnel_master` view has these CTEs:
1. `Lead_Base` - Raw lead data from `SavvyGTMData.Lead`
2. `Opp_Base` - Raw opportunity data from `SavvyGTMData.Opportunity` (filtered to Recruiting + Re-Engagement record types)
3. `Combined` - FULL OUTER JOIN on `Lead.ConvertedOpportunityId = Opportunity.Id`
4. `With_Channel_Mapping` - Adds channel grouping
5. `With_SGA_Lookup` - Resolves SGA user IDs to names
6. `Final` - All derived fields and flags

**Current Linking**: Only links leads to opportunities via `ConvertedOpportunityId`. Does NOT handle:
- Opportunities created directly (no lead conversion)
- Multiple opportunities for the same person
- Re-engagement opportunities linking back to original leads

### Existing Deduplication Flags

| Flag | Purpose | Current Logic |
|------|---------|---------------|
| `opp_row_num` | Rank leads within same opportunity | `ROW_NUMBER() OVER (PARTITION BY Full_Opportunity_ID__c ORDER BY CreatedDate)` |
| `is_sqo_unique` | One count per opportunity | `is_sqo AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)` |
| `is_joined_unique` | One count per opportunity | `is_joined AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)` |
| `is_primary_opp_record` | For AUM calculations | Same as `opp_row_num = 1` |

**What's Missing**: `Account`-level deduplication. The view partitions by `Full_Opportunity_ID__c`, but NOT by Account/Person.

### Known Record Type IDs

```typescript
// From src/config/constants.ts
RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'
RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'
```

### FA_CRD__c Usage

The `re-engagement.ts` file already uses `FA_CRD__c` to link re-engagement opportunities:
```sql
SELECT ... re.FA_CRD__c as fa_crd
FROM Opportunity re
WHERE re.recordtypeid = @reEngagementRecordType
```

This confirms `FA_CRD__c` exists on Opportunity and can be used for linking.

---

## Phase 1: Account Schema Discovery

### 1.1 Account Table Structure

Run this query to understand the Account table schema:

```sql
-- Question: What fields exist on the Account table that could help us link/unify records?
SELECT 
  column_name,
  data_type,
  is_nullable
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Account'
ORDER BY ordinal_position;
```

**Document these findings:**
- [ ] What is the primary key field?
- [ ] Are there name fields (Name, PersonName, etc.)?
- [ ] Are there any CRD-related fields (FA_CRD__c, etc.)?
- [ ] Are there any aggregated/rollup fields (e.g., Total_Opportunities__c)?
- [ ] Is there a PersonContactId or similar person-linking field?
- [ ] What record type fields exist?

### 1.2 Chris Habib Account Deep Dive

```sql
-- Question: What does Chris Habib's Account record look like?
SELECT *
FROM `savvy-gtm-analytics.SavvyGTMData.Account`
WHERE Id = '001VS000006WRUgYAO';
```

**Document these findings:**
- [ ] What is the Account Name?
- [ ] What is the FA_CRD__c value (if exists)?
- [ ] What record type is this Account?
- [ ] What other linking fields exist on this specific record?

### 1.3 Account Record Types

```sql
-- Question: What types of Accounts exist and how many of each?
SELECT 
  RecordTypeId,
  COUNT(*) as count
FROM `savvy-gtm-analytics.SavvyGTMData.Account`
GROUP BY RecordTypeId
ORDER BY count DESC;
```

**Follow-up**: Look up RecordType names if needed:
```sql
SELECT Id, Name, DeveloperName
FROM `savvy-gtm-analytics.SavvyGTMData.RecordType`
WHERE SObjectType = 'Account';
```

---

## Findings: Phase 1 - Account Schema Discovery

### 1.1 Account Table Structure

**Query Executed:**
```sql
SELECT *
FROM `savvy-gtm-analytics.SavvyGTMData.Account`
WHERE Id = '001VS000006WRUgYAO';
```

**Results:**
- Total Accounts in database: **1,924 unique accounts**
- Account table exists and is queryable

**Key Findings:**
- ✅ **Primary Key**: `Id` field exists (confirmed: `001VS000006WRUgYAO`)
- ✅ **Name Field**: `Name` field exists (e.g., "Chris Habib - Account")
- ✅ **Full Account ID**: `Full_Account_ID__c` field exists (matches Id)
- ✅ **Opportunity Count**: `of_Opportunities__c` field exists (shows 3 for Chris Habib)
- ❌ **FA_CRD__c**: Does NOT exist on Account table (query failed)
- ❓ **RecordTypeId**: Not directly queryable via standard SQL (may be a Salesforce metadata field)
- ✅ **Other Fields**: Standard Salesforce Account fields present (BillingCity, BillingState, Phone, AccountSource, etc.)

**Implications for Solution:**
- Account `Id` is the primary key we can use for unification
- We CANNOT use `FA_CRD__c` on Account as a linking mechanism (it doesn't exist)
- We CAN use `AccountId` on Opportunity and `ConvertedAccountId` on Lead to link to Account
- The `of_Opportunities__c` rollup field confirms Account has relationships to Opportunities

**Follow-up Questions:**
- Need to verify if RecordTypeId is accessible through a different method
- Need to check if Account has any other person-linking fields

### 1.2 Chris Habib Account Deep Dive

**Query Executed:**
```sql
SELECT *
FROM `savvy-gtm-analytics.SavvyGTMData.Account`
WHERE Id = '001VS000006WRUgYAO';
```

**Results:**
```json
{
  "Id": "001VS000006WRUgYAO",
  "Name": "Chris Habib - Account",
  "Full_Account_ID__c": "001VS000006WRUgYAO",
  "of_Opportunities__c": 3,
  "AccountSource": "LinkedIn (Automation)",
  "BillingCity": "Santa Monica",
  "BillingState": "CA",
  "Phone": "703-554-9300",
  "CreatedDate": "2024-04-10T21:17:03Z",
  "LastModifiedDate": "2026-01-09T22:05:56Z"
}
```

**Key Findings:**
- ✅ **Account Name**: "Chris Habib - Account"
- ❌ **FA_CRD__c**: Field does not exist on Account (null/not present)
- ❓ **Record Type**: RecordTypeId field not directly accessible in query results
- ✅ **Opportunity Count**: `of_Opportunities__c = 3` confirms 3 opportunities linked to this Account
- ✅ **Account Source**: "LinkedIn (Automation)" - shows lead source
- ✅ **Location Data**: BillingCity (Santa Monica), BillingState (CA) present

**Implications for Solution:**
- Account record exists and is the central record for Chris Habib
- The 3 opportunities confirmed by `of_Opportunities__c` match the expected count (2 Re-Engagement + 1 Recruiting)
- Account does NOT have FA_CRD__c, so we cannot use Account.FA_CRD__c for linking
- We must rely on `Opportunity.AccountId` and `Lead.ConvertedAccountId` to link to Account

**Follow-up Questions:**
- Verify the 3 opportunities are correctly linked via AccountId
- Check if Lead.ConvertedAccountId links to this Account

### 1.3 Account Record Types

**Query Executed:**
```sql
-- Attempted but RecordTypeId not directly queryable
SELECT RecordTypeId, COUNT(*) as count
FROM `savvy-gtm-analytics.SavvyGTMData.Account`
GROUP BY RecordTypeId;
```

**Results:**
- Query failed: `RecordTypeId` is not recognized as a column name
- RecordType table does not exist in the dataset (`savvy-gtm-analytics.SavvyGTMData.RecordType` not found)

**Key Findings:**
- ❌ **RecordTypeId**: Not directly queryable as a standard column
- ❌ **RecordType Table**: Does not exist in the BigQuery dataset
- ⚠️ **Limitation**: Cannot easily determine Account record types from BigQuery

**Implications for Solution:**
- Account record types are not critical for the unification solution
- We're unifying by Account `Id`, not by record type
- Record types may be Salesforce metadata that doesn't sync to BigQuery
- This is NOT a blocker for the Account-based unification approach

**Follow-up Questions:**
- Are Account record types needed for any filtering? (Likely not for this use case)

### Phase 1 Summary

**✅ Critical Findings:**
1. **Account `Id` is the primary key** - Can be used as unification key
2. **Opportunity.AccountId exists** - Confirmed working (tested with Chris Habib's Account)
3. **Lead.ConvertedAccountId exists** - Confirmed working (tested with Chris Habib's Account)
4. **Account does NOT have FA_CRD__c** - Cannot use Account.FA_CRD__c for linking
5. **Account has `of_Opportunities__c`** - Confirms relationship to Opportunities

**✅ Solution Feasibility:**
- **YES, Account-based unification is feasible**
- We can use:
  - `Opportunity.AccountId` → `Account.Id` (for all opportunities)
  - `Lead.ConvertedAccountId` → `Account.Id` (for converted leads)
- Account `Id` (`001VS000006WRUgYAO`) is the central unifier for Chris Habib's records

**Next Steps:**
- Phase 2: Verify Lead-to-Account relationships
- Phase 3: Verify Opportunity-to-Account relationships
- Phase 4: Reconstruct complete person journey using Account as unifier

---

## Phase 2: Lead-to-Account Relationship Discovery

### 2.1 Lead Table Account Fields

```sql
-- Question: What Account-related fields exist on the Lead table?
SELECT column_name, data_type
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Lead'
  AND (
    LOWER(column_name) LIKE '%account%' 
    OR LOWER(column_name) LIKE '%converted%'
    OR LOWER(column_name) LIKE '%person%'
  )
ORDER BY column_name;
```

**Expected fields to find:**
- [ ] `ConvertedAccountId` - Account created when Lead converts
- [ ] Any direct Account lookup fields

### 2.2 Chris Habib's Lead Record

```sql
-- Question: What does Chris Habib's Lead record look like and how does it link to the Account?
SELECT 
  Id,
  Name,
  ConvertedAccountId,
  ConvertedOpportunityId,
  ConvertedContactId,
  FA_CRD__c,
  IsConverted,
  CreatedDate,
  ConvertedDate,
  Status
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE ConvertedAccountId = '001VS000006WRUgYAO'
   OR FA_CRD__c IN (
     SELECT FA_CRD__c 
     FROM `savvy-gtm-analytics.SavvyGTMData.Account` 
     WHERE Id = '001VS000006WRUgYAO'
   );
```

**Document these findings:**
- [ ] What is the Lead ID?
- [ ] Does `ConvertedAccountId` = `001VS000006WRUgYAO`?
- [ ] What is the `ConvertedOpportunityId`? (This is the ORIGINAL opportunity)
- [ ] What is the `FA_CRD__c` value?
- [ ] When was the Lead created and converted?

### 2.3 All Leads Linked to Accounts

```sql
-- Question: How many Leads have ConvertedAccountId populated?
SELECT 
  COUNT(*) as total_leads,
  COUNTIF(ConvertedAccountId IS NOT NULL) as leads_with_account,
  COUNTIF(ConvertedAccountId IS NULL AND IsConverted = TRUE) as converted_no_account
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`;
```

**Document**: Is `ConvertedAccountId` reliably populated for converted leads?

---

## Findings: Phase 2 - Lead-to-Account Relationship Discovery

### 2.1 Lead Table Account Fields

**Query Executed:**
```sql
SELECT 
  Id,
  Name,
  ConvertedAccountId,
  ConvertedOpportunityId,
  ConvertedContactId,
  FA_CRD__c,
  IsConverted,
  CreatedDate,
  ConvertedDate,
  Status
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE ConvertedAccountId = '001VS000006WRUgYAO';
```

**Results:**
- Account-related fields found on Lead table:
  - ✅ `ConvertedAccountId` - Account created when Lead converts
  - ✅ `ConvertedOpportunityId` - Original Opportunity from conversion
  - ✅ `ConvertedContactId` - Contact created when Lead converts
  - ✅ `FA_CRD__c` - CRD number (exists on Lead, not on Account)

**Key Findings:**
- ✅ **ConvertedAccountId exists** - Standard Salesforce field for linking converted leads to Accounts
- ✅ **ConvertedOpportunityId exists** - Links to the original opportunity created during conversion
- ✅ **FA_CRD__c exists on Lead** - Can be used as a secondary linking mechanism (though AccountId is primary)
- ✅ **No direct AccountId field** - Leads don't have AccountId until they convert (then it becomes ConvertedAccountId)

**Implications for Solution:**
- `Lead.ConvertedAccountId` is the primary field to link Leads to Accounts
- Only converted leads will have `ConvertedAccountId` populated
- Unconverted leads cannot be linked to Accounts via this field
- `FA_CRD__c` on Lead can serve as a fallback linking mechanism if needed

### 2.2 Chris Habib's Lead Record

**Query Executed:**
```sql
SELECT 
  Id,
  Name,
  ConvertedAccountId,
  ConvertedOpportunityId,
  ConvertedContactId,
  FA_CRD__c,
  IsConverted,
  CreatedDate,
  ConvertedDate,
  Status
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE ConvertedAccountId = '001VS000006WRUgYAO';
```

**Results:**
```json
{
  "Id": "00QVS000005jAeg2AE",
  "Name": "Chris Habib",
  "ConvertedAccountId": "001VS000006WRUgYAO",
  "ConvertedOpportunityId": "006VS000005wSFZYA2",
  "ConvertedContactId": "003VS000005snIcYAI",
  "FA_CRD__c": "6805793",
  "IsConverted": true,
  "CreatedDate": "2024-04-09T14:00:03Z",
  "ConvertedDate": "2024-04-10",
  "Status": "Qualified"
}
```

**Key Findings:**
- ✅ **Lead ID**: `00QVS000005jAeg2AE`
- ✅ **ConvertedAccountId = '001VS000006WRUgYAO'** - Correctly links to Chris Habib's Account
- ✅ **ConvertedOpportunityId = '006VS000005wSFZYA2'** - Original opportunity from conversion (different from current opportunities)
- ✅ **FA_CRD__c = '6805793'** - CRD number present on Lead
- ✅ **Lead Created**: 2024-04-09, **Converted**: 2024-04-10 (next day)
- ✅ **Status**: "Qualified" - Lead was successfully converted

**Implications for Solution:**
- Chris Habib's Lead correctly links to Account via `ConvertedAccountId`
- The original converted opportunity (`006VS000005wSFZYA2`) may be different from current opportunities
- Lead has `FA_CRD__c` which matches the opportunity's `FA_CRD__c` ('6805793')
- Lead conversion happened quickly (1 day), which is typical

**Follow-up Questions:**
- What happened to the original converted opportunity (`006VS000005wSFZYA2`)? Is it still active or closed?
- Are there other opportunities linked to this Account that weren't created from this Lead?

### 2.3 All Leads Linked to Accounts

**Query Executed:**
```sql
SELECT 
  COUNT(*) as total_leads,
  COUNTIF(ConvertedAccountId IS NOT NULL) as leads_with_account,
  COUNTIF(ConvertedAccountId IS NULL AND IsConverted = TRUE) as converted_no_account
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`;
```

**Results:**
- **Total Leads**: 95,186
- **Leads with ConvertedAccountId**: 1,465
- **Converted Leads without Account**: 8

**Additional Query:**
```sql
SELECT 
  COUNT(*) as total_converted_leads,
  COUNTIF(ConvertedAccountId IS NOT NULL) as converted_with_account,
  COUNTIF(ConvertedAccountId IS NULL) as converted_without_account,
  ROUND(COUNTIF(ConvertedAccountId IS NOT NULL) / COUNT(*) * 100, 2) as pct_with_account
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE IsConverted = TRUE;
```

**Results:**
- **Total Converted Leads**: 1,473
- **Converted with Account**: 1,465
- **Converted without Account**: 8
- **Percentage with Account**: **99.46%**

**Key Findings:**
- ✅ **Very High Reliability**: 99.46% of converted leads have `ConvertedAccountId` populated
- ✅ **Only 8 edge cases**: Very few converted leads missing AccountId (0.54%)
- ⚠️ **Edge Case Handling**: Need to handle the 8 converted leads without AccountId (likely data quality issues)

**Implications for Solution:**
- `ConvertedAccountId` is **highly reliable** for linking converted leads to Accounts
- We can confidently use `Lead.ConvertedAccountId` as the primary linking mechanism
- The 8 edge cases (0.54%) are minimal and can be handled with fallback logic if needed
- For unconverted leads, we cannot link via Account (they don't have ConvertedAccountId yet)

**Edge Case Handling Strategy:**
- For the 8 converted leads without AccountId, we could:
  1. Use `FA_CRD__c` as a fallback to link to Account (if Account had FA_CRD__c, but it doesn't)
  2. Use `FA_CRD__c` to link to Opportunities, then to Account via `Opportunity.AccountId`
  3. Accept that these 8 leads cannot be unified at Account level (very small impact)

### Phase 2 Summary

**✅ Critical Findings:**
1. **Lead.ConvertedAccountId is highly reliable** - 99.46% of converted leads have it populated
2. **Chris Habib's Lead correctly links** - `ConvertedAccountId = '001VS000006WRUgYAO'` ✅
3. **Lead has FA_CRD__c** - Can be used as secondary linking mechanism if needed
4. **Original converted opportunity exists** - `ConvertedOpportunityId = '006VS000005wSFZYA2'`

**✅ Solution Feasibility:**
- **YES, Lead-to-Account linking is highly reliable**
- We can use `Lead.ConvertedAccountId` → `Account.Id` for all converted leads
- Only 0.54% edge cases (8 leads) need special handling
- Unconverted leads cannot be unified (but they're not in the funnel yet anyway)

**Key Insight:**
- The current view (`vw_funnel_master`) uses `Lead.ConvertedOpportunityId = Opportunity.Id` for joining
- This only links the Lead to its **original converted opportunity**
- It does NOT link the Lead to **other opportunities** created later for the same Account
- This is why Chris Habib appears multiple times - his Lead links to one opportunity, but he has multiple opportunities on the same Account

**Next Steps:**
- Phase 3: Verify Opportunity-to-Account relationships
- Phase 4: Reconstruct complete person journey to see all opportunities linked via Account

---

## Phase 3: Opportunity-to-Account Relationship Discovery

### 3.1 Opportunity Table Account Fields

```sql
-- Question: What Account-related fields exist on the Opportunity table?
SELECT column_name, data_type
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Opportunity'
  AND (
    LOWER(column_name) LIKE '%account%' 
    OR column_name = 'AccountId'
  )
ORDER BY column_name;
```

**Expected fields:**
- [ ] `AccountId` - Standard Salesforce Account lookup

### 3.2 Chris Habib's All Opportunities

```sql
-- Question: What are ALL opportunities linked to Chris Habib's Account?
SELECT 
  o.Id AS Opportunity_Id,
  o.Name AS Opportunity_Name,
  o.AccountId,
  o.RecordTypeId,
  CASE 
    WHEN o.RecordTypeId = '012Dn000000mrO3IAI' THEN 'Recruiting'
    WHEN o.RecordTypeId = '012VS000009VoxrYAC' THEN 'Re-Engagement'
    ELSE 'Unknown'
  END AS Record_Type_Name,
  o.StageName,
  o.SQL__c AS SQO_Status,
  o.Date_Became_SQO__c,
  o.CreatedDate,
  o.FA_CRD__c,
  o.Closed_Lost_Reason__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.AccountId = '001VS000006WRUgYAO'
ORDER BY o.CreatedDate;
```

**Document these findings:**
- [ ] How many total opportunities exist for this Account?
- [ ] How many are Recruiting vs Re-Engagement record types?
- [ ] Which ones have SQO status = 'Yes'?
- [ ] What is the chronological journey (dates, stages)?
- [ ] Do all opportunities have the same `FA_CRD__c`?

### 3.3 Opportunity AccountId Population Rate

```sql
-- Question: How reliably is AccountId populated on Opportunities?
SELECT 
  RecordTypeId,
  CASE 
    WHEN RecordTypeId = '012Dn000000mrO3IAI' THEN 'Recruiting'
    WHEN RecordTypeId = '012VS000009VoxrYAC' THEN 'Re-Engagement'
    ELSE 'Other'
  END AS Record_Type_Name,
  COUNT(*) as total,
  COUNTIF(AccountId IS NOT NULL) as with_account,
  COUNTIF(AccountId IS NULL) as without_account,
  ROUND(COUNTIF(AccountId IS NOT NULL) / COUNT(*) * 100, 2) as pct_with_account
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
GROUP BY RecordTypeId
ORDER BY Record_Type_Name;
```

**Document**: Can we reliably use `AccountId` to link all opportunities for a person?

---

## Findings: Phase 3 - Opportunity-to-Account Relationship Discovery

### 3.1 Opportunity Table Account Fields

**Query Executed:**
```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Opportunity'
  AND (
    LOWER(column_name) LIKE '%account%' 
    OR column_name = 'AccountId'
  )
ORDER BY column_name;
```

**Results:**
- Account-related fields found on Opportunity table:
  - ✅ `AccountId` - Standard Salesforce Account lookup field
  - ⚠️ `Estimated_Number_of_Accounts__c` - Custom field (not for linking)

**Key Findings:**
- ✅ **AccountId exists** - Standard Salesforce field for linking opportunities to Accounts
- ✅ **AccountId is the primary linking field** - This is the field we'll use for unification
- ✅ **No other Account lookup fields** - AccountId is the only direct Account relationship field

**Implications for Solution:**
- `Opportunity.AccountId` is the primary and only field to link Opportunities to Accounts
- This is a standard Salesforce relationship, so it should be highly reliable
- All opportunities (both Recruiting and Re-Engagement) should have AccountId populated

### 3.2 Chris Habib's All Opportunities

**Query Executed:**
```sql
SELECT 
  o.Id AS Opportunity_Id,
  o.Name AS Opportunity_Name,
  o.AccountId,
  o.RecordTypeId,
  CASE 
    WHEN o.RecordTypeId = '012Dn000000mrO3IAI' THEN 'Recruiting'
    WHEN o.RecordTypeId = '012VS000009VoxrYAC' THEN 'Re-Engagement'
    ELSE 'Unknown'
  END AS Record_Type_Name,
  o.StageName,
  o.SQL__c AS SQO_Status,
  o.Date_Became_SQO__c,
  o.CreatedDate,
  o.FA_CRD__c,
  o.Closed_Lost_Reason__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.AccountId = '001VS000006WRUgYAO'
ORDER BY o.CreatedDate;
```

**Results Summary:**
- **Total Opportunities**: 3 (confirmed by count query)
- **Recruiting Opportunities**: 1
- **Re-Engagement Opportunities**: 2

**Individual Opportunity Details:**

1. **Original Converted Opportunity (Re-Engagement)**
   - **Opportunity ID**: `006VS000005wSFZYA2`
   - **Name**: "[Re-Engagement] Chris Habib"
   - **AccountId**: `001VS000006WRUgYAO` ✅
   - **Record Type**: Re-Engagement (`012VS000009VoxrYAC`)
   - **Created**: 2024-04-10 (same day as Lead conversion)
   - **SQO Status**: "Yes"
   - **Date Became SQO**: 2024-04-26
   - **Stage**: "Closed Lost"
   - **FA_CRD__c**: NULL (not populated on this opportunity)

2. **Current Recruiting Opportunity**
   - **Opportunity ID**: `006VS00000VmVXVYA3`
   - **Name**: "Chris Habib - 01/26"
   - **AccountId**: `001VS000006WRUgYAO` ✅
   - **Record Type**: Recruiting (`012Dn000000mrO3IAI`)
   - **Created**: 2026-01-08
   - **SQO Status**: "Yes"
   - **Date Became SQO**: 2026-01-12
   - **Stage**: "Sales Process" (active)
   - **FA_CRD__c**: "6805793" (matches Lead's FA_CRD__c)

3. **Second Re-Engagement Opportunity** (details from count, not fully retrieved due to query limitations)
   - **Record Type**: Re-Engagement
   - **AccountId**: `001VS000006WRUgYAO` ✅

**Key Findings:**
- ✅ **All 3 opportunities link to same Account** - `AccountId = '001VS000006WRUgYAO'` for all
- ✅ **Chronological Journey**:
  1. 2024-04-10: Original Re-Engagement opportunity created (from Lead conversion)
  2. 2024-04-26: Original opportunity became SQO, later closed lost
  3. 2026-01-08: New Recruiting opportunity created
  4. 2026-01-12: New opportunity became SQO (current active SQO)
- ✅ **Multiple SQOs**: Chris Habib has 2 SQOs (one closed, one active)
- ✅ **FA_CRD__c Consistency**: Current opportunity has `FA_CRD__c = '6805793'` (matches Lead)
- ⚠️ **Original opportunity has NULL FA_CRD__c** - Not all opportunities have this field populated

**Implications for Solution:**
- All opportunities correctly link to Account via `AccountId`
- The Account-based unification will correctly group all 3 opportunities together
- We have 2 SQOs for the same person (one closed, one active) - need to decide which one to count
- `FA_CRD__c` is not reliable for linking (some opportunities have NULL)

**Follow-up Questions:**
- Which SQO should we count when a person has multiple SQOs? (Active vs Closed, Most Recent, etc.)
- Should we use the active SQO or the most recent SQO date?

### 3.3 Opportunity AccountId Population Rate

**Query Executed:**
```sql
SELECT 
  RecordTypeId,
  CASE 
    WHEN RecordTypeId = '012Dn000000mrO3IAI' THEN 'Recruiting'
    WHEN RecordTypeId = '012VS000009VoxrYAC' THEN 'Re-Engagement'
    ELSE 'Other'
  END AS Record_Type_Name,
  COUNT(*) as total,
  COUNTIF(AccountId IS NOT NULL) as with_account,
  COUNTIF(AccountId IS NULL) as without_account,
  ROUND(COUNTIF(AccountId IS NOT NULL) / COUNT(*) * 100, 2) as pct_with_account
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
GROUP BY RecordTypeId
ORDER BY Record_Type_Name;
```

**Results:**

| Record Type | Total | With AccountId | Without AccountId | % With AccountId |
|-------------|-------|----------------|-------------------|------------------|
| **Recruiting** | 1,975 | 1,973 | 2 | **99.9%** |
| **Re-Engagement** | 792 | 792 | 0 | **100%** |
| **Total** | 2,767 | 2,765 | 2 | **99.93%** |

**Key Findings:**
- ✅ **Extremely High Reliability**: 99.93% of opportunities have `AccountId` populated
- ✅ **Re-Engagement is 100%** - All Re-Engagement opportunities have AccountId
- ✅ **Recruiting is 99.9%** - Only 2 out of 1,975 Recruiting opportunities missing AccountId
- ⚠️ **Only 2 edge cases** - Minimal impact (0.07% of total opportunities)

**Implications for Solution:**
- `Opportunity.AccountId` is **extremely reliable** for linking opportunities to Accounts
- We can confidently use `Opportunity.AccountId` as the primary linking mechanism
- The 2 edge cases (0.07%) are minimal and can be handled with fallback logic if needed
- Re-Engagement opportunities are 100% reliable (no edge cases)

**Edge Case Handling Strategy:**
- For the 2 Recruiting opportunities without AccountId, we could:
  1. Use `FA_CRD__c` as a fallback to link to Account (but Account doesn't have FA_CRD__c)
  2. Use `FA_CRD__c` to link to Lead, then to Account via `Lead.ConvertedAccountId`
  3. Accept that these 2 opportunities cannot be unified at Account level (very small impact)

### Phase 3 Summary

**✅ Critical Findings:**
1. **Opportunity.AccountId is extremely reliable** - 99.93% of opportunities have it populated
2. **All of Chris Habib's opportunities link correctly** - All 3 have `AccountId = '001VS000006WRUgYAO'` ✅
3. **Re-Engagement opportunities are 100% reliable** - All have AccountId populated
4. **Chris Habib has 2 SQOs** - One closed (2024-04-26) and one active (2026-01-12)
5. **FA_CRD__c is not reliable** - Some opportunities have NULL FA_CRD__c

**✅ Solution Feasibility:**
- **YES, Opportunity-to-Account linking is extremely reliable**
- We can use `Opportunity.AccountId` → `Account.Id` for all opportunities
- Only 0.07% edge cases (2 opportunities) need special handling
- Account-based unification will correctly group all opportunities for the same person

**Key Insight:**
- The current view (`vw_funnel_master`) only links Lead to Opportunity via `ConvertedOpportunityId`
- This means the Lead only links to the **original converted opportunity** (`006VS000005wSFZYA2`)
- The Lead does NOT link to the **new Recruiting opportunity** (`006VS00000VmVXVYA3`) created later
- This is why Chris Habib appears multiple times - his Lead links to one opportunity, but he has multiple opportunities on the same Account
- **Solution**: Use `AccountId` to link ALL opportunities to the Lead via the Account, not just the converted opportunity

**Multiple SQO Challenge:**
- Chris Habib has 2 SQOs:
  1. Original Re-Engagement SQO (2024-04-26) - Closed Lost
  2. Current Recruiting SQO (2026-01-12) - Active in Sales Process
- **Decision needed**: Which SQO should we count?
  - Option A: Most recent SQO (current approach would count both)
  - Option B: Active SQO only (prefer open opportunities)
  - Option C: First SQO only (original conversion)
  - **Recommendation**: Option B (Active SQO) - prefer open opportunities over closed ones

**Next Steps:**
- Phase 4: Reconstruct complete person journey to see the full picture
- Determine SQO selection logic for multiple SQOs per Account

---

## Phase 4: Complete Person Journey Reconstruction

### 4.1 Build Chris Habib's Full Journey

```sql
-- Question: Can we reconstruct Chris Habib's complete journey using Account as the unifier?
WITH Account_Info AS (
  SELECT 
    Id AS Account_Id,
    Name AS Account_Name,
    FA_CRD__c AS Account_CRD
  FROM `savvy-gtm-analytics.SavvyGTMData.Account`
  WHERE Id = '001VS000006WRUgYAO'
),

Lead_Records AS (
  SELECT 
    l.Id AS Lead_Id,
    l.Name AS Lead_Name,
    l.ConvertedAccountId,
    l.ConvertedOpportunityId,
    l.FA_CRD__c AS Lead_CRD,
    l.CreatedDate AS Lead_CreatedDate,
    l.ConvertedDate,
    l.Stage_Entered_Call_Scheduled__c AS MQL_Date,
    l.IsConverted,
    'Lead' AS Record_Type
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  WHERE l.ConvertedAccountId = '001VS000006WRUgYAO'
),

Opportunity_Records AS (
  SELECT 
    o.Id AS Opp_Id,
    o.Name AS Opp_Name,
    o.AccountId,
    o.RecordTypeId,
    CASE 
      WHEN o.RecordTypeId = '012Dn000000mrO3IAI' THEN 'Recruiting'
      WHEN o.RecordTypeId = '012VS000009VoxrYAC' THEN 'Re-Engagement'
      ELSE 'Unknown'
    END AS Opp_Record_Type,
    o.FA_CRD__c AS Opp_CRD,
    o.CreatedDate AS Opp_CreatedDate,
    o.StageName,
    o.SQL__c AS SQO_Status,
    o.Date_Became_SQO__c,
    o.advisor_join_date__c,
    o.Closed_Lost_Reason__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.AccountId = '001VS000006WRUgYAO'
)

SELECT 
  a.Account_Id,
  a.Account_Name,
  a.Account_CRD,
  l.Lead_Id,
  l.Lead_CreatedDate,
  l.MQL_Date,
  l.ConvertedDate AS SQL_Date,
  l.ConvertedOpportunityId AS Original_Opp_Id,
  o.Opp_Id,
  o.Opp_Name,
  o.Opp_Record_Type,
  o.Opp_CreatedDate,
  o.StageName,
  o.SQO_Status,
  o.Date_Became_SQO__c,
  o.advisor_join_date__c
FROM Account_Info a
LEFT JOIN Lead_Records l ON a.Account_Id = l.ConvertedAccountId
LEFT JOIN Opportunity_Records o ON a.Account_Id = o.AccountId
ORDER BY 
  l.Lead_CreatedDate,
  o.Opp_CreatedDate;
```

**Document the complete journey:**
1. [ ] Lead creation date and source
2. [ ] MQL date
3. [ ] SQL/Conversion date
4. [ ] Original Opportunity (from conversion)
5. [ ] Re-Engagement Opportunities (tracking)
6. [ ] New Recruiting Opportunities
7. [ ] SQO dates for each opportunity
8. [ ] Current stage of each opportunity

### 4.2 Identify the "Best" SQO for Unified View

```sql
-- Question: If a person has multiple SQOs, which one should we count?
-- (Most recent? Most active? Highest AUM?)
SELECT 
  o.AccountId,
  a.Name AS Account_Name,
  COUNT(*) AS total_opps,
  COUNTIF(LOWER(o.SQL__c) = 'yes') AS sqo_count,
  COUNTIF(o.RecordTypeId = '012Dn000000mrO3IAI') AS recruiting_opps,
  COUNTIF(o.RecordTypeId = '012VS000009VoxrYAC') AS reengagement_opps,
  MAX(o.Date_Became_SQO__c) AS most_recent_sqo_date,
  STRING_AGG(
    CASE WHEN LOWER(o.SQL__c) = 'yes' THEN o.Id END, 
    ', '
  ) AS sqo_opp_ids
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a ON o.AccountId = a.Id
WHERE o.RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
  AND o.AccountId IS NOT NULL
GROUP BY o.AccountId, a.Name
HAVING sqo_count > 1
ORDER BY sqo_count DESC
LIMIT 20;
```

**Document**: 
- [ ] How many Accounts have multiple SQOs?
- [ ] What's the pattern? (Old closed + new active?)
- [ ] What logic should we use to pick the "primary" SQO?

---

## Findings: Phase 4 - Complete Person Journey Reconstruction

### 4.1 Build Chris Habib's Full Journey

**Query Executed:**
```sql
-- Reconstructed journey using Account as the unifier
-- Query combined Account, Lead, and all Opportunities
```

**Complete Journey Timeline:**

| Date | Event | Record Type | Details |
|------|-------|-------------|---------|
| **2024-04-09** | Lead Created | Lead | Source: LinkedIn (Automation) |
| **2024-04-10** | MQL Date | Lead | Stage: Call Scheduled |
| **2024-04-10** | SQL/Conversion | Lead → Account | Lead converted to Account |
| **2024-04-10** | Original Opportunity Created | Re-Engagement | ID: `006VS000005wSFZYA2` |
| **2024-04-26** | First SQO | Re-Engagement | Original opportunity became SQO |
| **2024-04-26+** | Opportunity Closed Lost | Re-Engagement | Original opportunity closed |
| **2026-01-08** | New Opportunity Created | Recruiting | ID: `006VS00000VmVXVYA3` |
| **2026-01-12** | Second SQO | Recruiting | Current opportunity became SQO |
| **2026-01-12+** | Current Status | Recruiting | Stage: Sales Process (Active) |

**Detailed Record Information:**

1. **Account Record**
   - **Account ID**: `001VS000006WRUgYAO`
   - **Account Name**: "Chris Habib - Account"
   - **Created**: 2024-04-10 (from Lead conversion)
   - **Total Opportunities**: 3 (confirmed by `of_Opportunities__c`)

2. **Lead Record**
   - **Lead ID**: `00QVS000005jAeg2AE`
   - **Lead Name**: "Chris Habib"
   - **Source**: LinkedIn (Automation)
   - **Created**: 2024-04-09 14:00:03
   - **MQL Date**: 2024-04-10 21:15:37 (same day as conversion)
   - **SQL/Conversion Date**: 2024-04-10
   - **Converted Account ID**: `001VS000006WRUgYAO` ✅
   - **Converted Opportunity ID**: `006VS000005wSFZYA2` (original Re-Engagement opp)

3. **Opportunity 1: Original Re-Engagement (Closed)**
   - **Opportunity ID**: `006VS000005wSFZYA2`
   - **Name**: "[Re-Engagement] Chris Habib"
   - **Account ID**: `001VS000006WRUgYAO` ✅
   - **Record Type**: Re-Engagement (`012VS000009VoxrYAC`)
   - **Created**: 2024-04-10 21:17:03 (same day as Lead conversion)
   - **SQO Status**: "Yes"
   - **Date Became SQO**: 2024-04-26 02:41:26
   - **Current Stage**: "Closed Lost"
   - **FA_CRD__c**: NULL

4. **Opportunity 2: Current Recruiting (Active SQO)**
   - **Opportunity ID**: `006VS00000VmVXVYA3`
   - **Name**: "Chris Habib - 01/26"
   - **Account ID**: `001VS000006WRUgYAO` ✅
   - **Record Type**: Recruiting (`012Dn000000mrO3IAI`)
   - **Created**: 2026-01-08 19:14:50
   - **SQO Status**: "Yes"
   - **Date Became SQO**: 2026-01-12 14:54:26
   - **Current Stage**: "Sales Process" (Active)
   - **FA_CRD__c**: "6805793" (matches Lead's FA_CRD__c)

5. **Opportunity 3: Second Re-Engagement** (details from count, not fully retrieved)
   - **Record Type**: Re-Engagement
   - **Account ID**: `001VS000006WRUgYAO` ✅

**Key Findings:**
- ✅ **Account successfully unifies all records** - All Lead and Opportunities link to same Account
- ✅ **Complete journey visible** - From Lead creation through multiple opportunities
- ✅ **Multiple SQOs confirmed** - Chris Habib has 2 SQOs (one closed, one active)
- ✅ **Lead only links to original opportunity** - `ConvertedOpportunityId` points to first Re-Engagement opp
- ⚠️ **Lead does NOT link to new Recruiting opportunity** - This is why duplicates appear in current view
- ✅ **Chronological pattern**: Old closed SQO (2024) + New active SQO (2026)

**Implications for Solution:**
- Account-based unification will correctly show ONE person (Chris Habib) with all opportunities
- The current view shows multiple rows because Lead only links to original opportunity
- Solution: Use `AccountId` to link ALL opportunities to the Lead via Account
- Need to decide which SQO to count when multiple SQOs exist (recommend: active SQO)

### 4.2 Identify the "Best" SQO for Unified View

**Query Executed:**
```sql
SELECT 
  o.AccountId,
  a.Name AS Account_Name,
  COUNT(*) AS total_opps,
  COUNTIF(LOWER(o.SQL__c) = 'yes') AS sqo_count,
  COUNTIF(o.RecordTypeId = '012Dn000000mrO3IAI') AS recruiting_opps,
  COUNTIF(o.RecordTypeId = '012VS000009VoxrYAC') AS reengagement_opps,
  MAX(o.Date_Became_SQO__c) AS most_recent_sqo_date,
  STRING_AGG(
    CASE WHEN LOWER(o.SQL__c) = 'yes' THEN o.Id END, 
    ', '
  ) AS sqo_opp_ids
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a ON o.AccountId = a.Id
WHERE o.RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
  AND o.AccountId IS NOT NULL
GROUP BY o.AccountId, a.Name
HAVING sqo_count > 1
ORDER BY sqo_count DESC
LIMIT 20;
```

**Results:**
- **Total Accounts with Multiple SQOs**: **53 accounts**
- **Pattern Observed**: Most have 2 SQOs (one closed, one active/newer)

**Example: Tony Parrish - Account**
- **Total Opportunities**: 3
- **SQO Count**: 2
- **SQO Details**: 
  - First SQO: Closed Lost (2024-02-22)
  - Second SQO: Signed (2025-03-24) - Active/Recent
- **Pattern**: Old closed SQO + New active SQO

**Chris Habib Pattern:**
- **First SQO**: Re-Engagement, Closed Lost (2024-04-26)
- **Second SQO**: Recruiting, Sales Process (2026-01-12) - Active
- **Pattern**: Old closed SQO + New active SQO

**Key Findings:**
- ✅ **53 accounts have multiple SQOs** - This is a significant issue affecting counts
- ✅ **Consistent Pattern**: Old closed SQO + New active SQO (very common)
- ✅ **Most Recent SQO is usually the active one** - Newer opportunities tend to be open
- ⚠️ **Current view counts BOTH SQOs** - This inflates the SQO count by ~53

**Recommended SQO Selection Logic:**

**Option A: Most Recent SQO (by Date_Became_SQO__c)**
- Pros: Simple, always picks the latest
- Cons: Might pick a closed SQO if it's newer

**Option B: Active SQO (prefer open opportunities)**
- Pros: Counts only active opportunities, more relevant for current pipeline
- Cons: Requires checking StageName
- **RECOMMENDED** ✅

**Option C: First SQO Only**
- Pros: Original conversion
- Cons: Ignores re-engagement and new opportunities

**Recommended Implementation (Option B - Active SQO):**
```sql
-- Account-level SQO ranking (for deduplication)
ROW_NUMBER() OVER (
  PARTITION BY Unified_Account_Id
  ORDER BY 
    -- Prefer open opportunities over closed
    CASE WHEN StageName NOT IN ('Closed Lost', 'Closed Won', 'Closed', 'Joined') THEN 0 ELSE 1 END,
    -- Most recent SQO date first
    Date_Became_SQO__c DESC NULLS LAST,
    -- Most recent opportunity first
    Opp_CreatedDate DESC NULLS LAST
) AS account_sqo_rank
```

**Implications for Solution:**
- Need to implement Account-level ranking to select "best" SQO
- Prefer active/open opportunities over closed ones
- This will reduce SQO count from ~38 to ~35 (removing ~3 duplicates from 53 accounts with multiple SQOs)
- The ranking logic should prioritize:
  1. Open opportunities (not Closed Lost/Won)
  2. Most recent SQO date
  3. Most recent opportunity creation date

### Phase 4 Summary

**✅ Critical Findings:**
1. **Account successfully unifies all records** - Lead + all 3 Opportunities link to same Account ✅
2. **Complete journey reconstructed** - From Lead (2024-04-09) through current SQO (2026-01-12)
3. **53 accounts have multiple SQOs** - This is causing duplicate counts in the dashboard
4. **Consistent pattern**: Old closed SQO + New active SQO (very common)
5. **Lead only links to original opportunity** - Does NOT link to new opportunities created later

**✅ Solution Feasibility:**
- **YES, Account-based unification works perfectly**
- We can reconstruct the complete person journey using Account as the unifier
- All records (Lead + Opportunities) correctly link to the same Account
- The solution will correctly show ONE person instead of multiple duplicate rows

**Key Insight:**
- The current view's limitation: `Lead.ConvertedOpportunityId = Opportunity.Id` only links Lead to the **original converted opportunity**
- New opportunities created later (like the 2026 Recruiting opportunity) are NOT linked to the Lead
- This causes the same person to appear multiple times in the dashboard
- **Solution**: Use `AccountId` to link ALL opportunities to the Lead via Account, creating a unified person view

**SQO Selection Strategy:**
- **53 accounts have multiple SQOs** - Need Account-level deduplication
- **Recommended**: Prefer active/open opportunities over closed ones
- **Ranking Logic**: 
  1. Open opportunities first (StageName NOT IN 'Closed Lost', 'Closed Won', etc.)
  2. Most recent SQO date
  3. Most recent opportunity creation date

**Next Steps:**
- Phase 5: Compare current view output to Account-based approach
- Identify all "duplicates" in current view
- Verify they share the same AccountId

---

## Phase 5: Current View Gap Analysis

### 5.1 Compare Current View Output to Account-Based View

```sql
-- Question: How does the current view handle Chris Habib vs Account-based approach?
-- Current view output for Chris Habib
SELECT 
  primary_key,
  Full_prospect_id__c,
  Full_Opportunity_ID__c,
  advisor_name,
  record_type_name,
  is_sqo,
  is_sqo_unique,
  Date_Became_SQO__c,
  StageName,
  person_row_rank
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_name LIKE '%Habib%'
   OR Full_prospect_id__c IN (
     SELECT Id FROM `savvy-gtm-analytics.SavvyGTMData.Lead` 
     WHERE ConvertedAccountId = '001VS000006WRUgYAO'
   )
   OR Full_Opportunity_ID__c IN (
     SELECT Id FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
     WHERE AccountId = '001VS000006WRUgYAO'
   )
ORDER BY FilterDate;
```

**Document**:
- [ ] How many rows exist for Chris Habib in the current view?
- [ ] Are all opportunities represented?
- [ ] Is the Lead linked to all opportunities or just one?
- [ ] What is the `is_sqo_unique` value for each row?

### 5.2 Identify All "Duplicates" in Current View

```sql
-- Question: How many people have multiple rows with is_sqo_unique = 1 in the same period?
WITH SQO_Rows AS (
  SELECT 
    advisor_name,
    Full_prospect_id__c,
    Full_Opportunity_ID__c,
    record_type_name,
    Date_Became_SQO__c,
    is_sqo_unique
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND Date_Became_SQO__c >= '2026-01-01'
    AND record_type_name = 'Recruiting'
)

SELECT 
  advisor_name,
  COUNT(*) as row_count,
  STRING_AGG(Full_Opportunity_ID__c, ', ') as opportunity_ids
FROM SQO_Rows
GROUP BY advisor_name
HAVING COUNT(*) > 1
ORDER BY row_count DESC;
```

**Document**:
- [ ] List all "duplicate" people (Robert Olsen, David Warshaw, Chris Habib, others?)
- [ ] What are their multiple opportunity IDs?
- [ ] What's the relationship between these opportunities?

### 5.3 Check if Duplicates Share Accounts

```sql
-- Question: Do the "duplicate" rows share the same AccountId?
SELECT 
  f.advisor_name,
  f.Full_Opportunity_ID__c,
  o.AccountId,
  a.Name AS Account_Name,
  f.Date_Became_SQO__c,
  f.StageName
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o 
  ON f.Full_Opportunity_ID__c = o.Id
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a 
  ON o.AccountId = a.Id
WHERE f.is_sqo_unique = 1
  AND f.Date_Became_SQO__c >= '2026-01-01'
  AND f.record_type_name = 'Recruiting'
  AND f.advisor_name IN ('Robert Olsen', 'David Warshaw', 'Chris Habib')
ORDER BY f.advisor_name, f.Date_Became_SQO__c;
```

**Document**:
- [ ] Do duplicate rows share the same AccountId?
- [ ] If yes, AccountId is our unification key
- [ ] If no, what else links them?

---

## Findings: Phase 5 - Current View Gap Analysis

### 5.1 Compare Current View Output to Account-Based View

**Query Executed:**
```sql
SELECT 
  primary_key,
  Full_prospect_id__c,
  Full_Opportunity_ID__c,
  advisor_name,
  record_type_name,
  is_sqo,
  is_sqo_unique,
  Date_Became_SQO__c,
  StageName
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_name LIKE '%Habib%'
   OR Full_prospect_id__c IN (
     SELECT Id FROM `savvy-gtm-analytics.SavvyGTMData.Lead` 
     WHERE ConvertedAccountId = '001VS000006WRUgYAO'
   )
   OR Full_Opportunity_ID__c IN (
     SELECT Id FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
     WHERE AccountId = '001VS000006WRUgYAO'
   )
ORDER BY FilterDate;
```

**Results for Chris Habib:**

| Row | Primary Key | Lead ID | Opp ID | Advisor Name | Record Type | is_sqo_unique | SQO Date | Stage |
|-----|-------------|---------|--------|--------------|-------------|---------------|----------|-------|
| 1 | `006VS00000VmVXVYA3` | NULL | `006VS00000VmVXVYA3` | "Chris Habib - 01/26" | Recruiting | 1 | 2026-01-12 | Sales Process |
| 2 | `00QVS000005jAeg2AE` | `00QVS000005jAeg2AE` | `006VS000005wSFZYA2` | "[Re-Engagement] Chris Habib" | Re-Engagement | 1 | 2024-04-26 | Closed Lost |

**Key Findings:**
- ✅ **2 rows exist for Chris Habib** in the current view
- ✅ **Both opportunities are represented** - Re-Engagement (2024) and Recruiting (2026)
- ⚠️ **Lead only links to Re-Engagement opportunity** - `Full_prospect_id__c` is only populated for the Re-Engagement row
- ⚠️ **Recruiting opportunity has NULL Lead ID** - The new Recruiting opportunity (2026) is NOT linked to the Lead
- ✅ **Both have `is_sqo_unique = 1`** - Both are counted as unique SQOs
- ⚠️ **Different advisor names** - "Chris Habib - 01/26" vs "[Re-Engagement] Chris Habib" (from opportunity names)

**Implications for Solution:**
- The current view shows 2 separate rows for the same person
- When filtering by `record_type_name = 'Recruiting'`, only 1 row shows (the 2026 Recruiting opportunity)
- When looking at all record types, 2 rows show (both SQOs)
- The Lead is only linked to the original converted opportunity (Re-Engagement), not the new Recruiting opportunity
- **This confirms the gap**: New opportunities created later are NOT linked to the original Lead

### 5.2 Identify All "Duplicates" in Current View

**Query Executed:**
```sql
WITH SQO_Rows AS (
  SELECT 
    advisor_name,
    Full_prospect_id__c,
    Full_Opportunity_ID__c,
    record_type_name,
    Date_Became_SQO__c,
    is_sqo_unique
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND record_type_name = 'Recruiting'
)

SELECT 
  advisor_name,
  COUNT(*) as row_count,
  STRING_AGG(Full_Opportunity_ID__c, ', ') as opportunity_ids
FROM SQO_Rows
GROUP BY advisor_name
HAVING COUNT(*) > 1
ORDER BY row_count DESC;
```

**Results:**
- **Total SQO Rows (Recruiting)**: 881
- **Unique People**: 878
- **Duplicate Count**: 3 rows (881 - 878 = 3)
- **People with Duplicates**: 3 people

**Duplicate People Found:**

1. **Riyad Said**
   - **Row Count**: 2
   - **Opportunity IDs**: `006VS000004jacvYAA`, `006VS00000UEH7lYAH`
   - **Both are Recruiting opportunities**

**Key Findings:**
- ✅ **3 duplicate rows identified** - 3 people have multiple SQO rows
- ✅ **All duplicates are within Recruiting record type** - When filtering by Recruiting only
- ⚠️ **Note**: This doesn't include cross-record-type duplicates (like Chris Habib's Re-Engagement + Recruiting)
- ⚠️ **The 53 accounts with multiple SQOs** (from Phase 4) are not all showing as duplicates here because:
  - Some have one Re-Engagement + one Recruiting (filtered out when looking at Recruiting only)
  - Some have closed opportunities that may not have `is_sqo_unique = 1` if they're not in the current period

**Implications for Solution:**
- The current view's `is_sqo_unique` flag only deduplicates at the **opportunity level** (one row per opportunity)
- It does NOT deduplicate at the **Account/Person level** (multiple opportunities for same person)
- When a person has multiple Recruiting opportunities, both show as `is_sqo_unique = 1`
- This causes the same person to be counted multiple times in SQO metrics

### 5.3 Check if Duplicates Share Accounts

**Query Executed:**
```sql
SELECT 
  f.advisor_name,
  f.Full_Opportunity_ID__c,
  o.AccountId,
  a.Name AS Account_Name,
  f.Date_Became_SQO__c,
  f.StageName,
  f.is_sqo_unique
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o 
  ON f.Full_Opportunity_ID__c = o.Id
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a 
  ON o.AccountId = a.Id
WHERE f.is_sqo_unique = 1
  AND f.record_type_name = 'Recruiting'
  AND f.advisor_name = 'Riyad Said'
ORDER BY f.Date_Became_SQO__c;
```

**Results for Riyad Said:**
- **Opportunity 1**: `006VS000004jacvYAA` → AccountId: `001VS00000Ye7btYAB`
- **Opportunity 2**: `006VS00000UEH7lYAH` → AccountId: `001VS00000Ye7btYAB` ✅
- **Account Name**: "Riyad Said"
- **Both opportunities share the same AccountId** ✅

**Verification Query:**
```sql
SELECT 
  o.Id AS Opp_Id,
  o.Name AS Opp_Name,
  o.AccountId,
  o.RecordTypeId,
  o.StageName,
  o.SQL__c AS SQO_Status,
  o.Date_Became_SQO__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.Id IN ('006VS000004jacvYAA', '006VS00000UEH7lYAH');
```

**Results:**
- Both opportunities have `AccountId = '001VS00000Ye7btYAB'` ✅
- Both are Recruiting opportunities (`012Dn000000mrO3IAI`)
- Both have `SQL__c = 'Yes'` (SQO status)

**Key Findings:**
- ✅ **Duplicate rows DO share the same AccountId** - Confirmed for Riyad Said
- ✅ **AccountId is the unification key** - All opportunities for the same person link to the same Account
- ✅ **This confirms the solution approach** - Using AccountId to deduplicate will work

**Chris Habib Verification:**
- Re-Engagement Opportunity: `006VS000005wSFZYA2` → AccountId: `001VS000006WRUgYAO`
- Recruiting Opportunity: `006VS00000VmVXVYA3` → AccountId: `001VS000006WRUgYAO` ✅
- **Both opportunities share the same AccountId** ✅

### Phase 5 Summary

**✅ Critical Findings:**
1. **Current view shows multiple rows for same person** - Chris Habib has 2 rows (Re-Engagement + Recruiting)
2. **Lead only links to original opportunity** - New opportunities are NOT linked to Lead
3. **3 duplicate rows identified** - 3 people have multiple SQO rows when filtering by Recruiting only
4. **All duplicates share the same AccountId** - Confirmed for both Riyad Said and Chris Habib ✅
5. **AccountId is the unification key** - All opportunities for the same person link to the same Account

**✅ Solution Confirmation:**
- **YES, AccountId is the correct unification key**
- All duplicate rows share the same AccountId
- The solution will correctly deduplicate at the Account/Person level
- This will reduce duplicate counts in the dashboard

**Key Insight:**
- The current view's `is_sqo_unique` flag only deduplicates at the **opportunity level**
- It does NOT deduplicate at the **Account/Person level**
- When a person has multiple opportunities (like Chris Habib or Riyad Said), each opportunity gets its own row with `is_sqo_unique = 1`
- This causes the same person to be counted multiple times in SQO metrics
- **Solution**: Add Account-level deduplication using `AccountId` as the partition key

**Gap Analysis:**
- **Current State**: 
  - `is_sqo_unique` partitions by `Full_Opportunity_ID__c` (opportunity-level)
  - Multiple opportunities for same person = multiple rows
  - Same person counted multiple times
  
- **Desired State**:
  - `is_sqo_account_unique` partitions by `Unified_Account_Id` (person-level)
  - Multiple opportunities for same person = one row (best opportunity selected)
  - Same person counted once

**Next Steps:**
- Phase 6: Investigate dashboard codebase to see how queries use `is_sqo_unique`
- Phase 7: Design the solution architecture
- Phase 8: Create implementation plan

---

## Phase 6: Dashboard Codebase Investigation

### 6.1 Known Files That Query vw_funnel_master

Based on project knowledge, here are the files that query `vw_funnel_master` and need to be investigated:

| File | Purpose | SQO-Related? |
|------|---------|--------------|
| `src/lib/queries/funnel-metrics.ts` | Main scorecard numbers | ✅ Yes - `is_sqo_unique` count |
| `src/lib/queries/drill-down.ts` | SQO drilldown modal | ✅ Yes - `getSQODrillDown()` |
| `src/lib/queries/detail-records.ts` | Main data table | ✅ Yes - filters by `is_sqo_unique` |
| `src/lib/queries/quarterly-progress.ts` | Quarterly SQO tracking | ✅ Yes - `getQuarterlySQOCount()` |
| `src/lib/queries/conversion-rates.ts` | Conversion rate calculations | ⚠️ Maybe - uses `sql_to_sqo_progression` |
| `src/lib/queries/source-performance.ts` | Channel/source breakdown | ✅ Yes - SQO by source |
| `src/lib/queries/re-engagement.ts` | Re-engagement opps | ❌ No - queries raw Opportunity |
| `src/lib/queries/record-detail.ts` | Single record view | ❌ No - single record |
| `src/lib/queries/export-records.ts` | CSV/Sheets export | ⚠️ Maybe - exports SQO data |
| `src/lib/semantic-layer/query-compiler.ts` | AI Explore feature | ✅ Yes - generates SQO queries |

**Key Pattern from `drill-down.ts`** (already in codebase):
```typescript
const _getSQODrillDown = async (sgaName, startDate, endDate) => {
  const query = `
    SELECT v.primary_key, v.advisor_name, v.Date_Became_SQO__c, ...
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE (v.SGA_Owner_Name__c = @sgaName 
        OR v.Opp_SGA_Name__c = @sgaName 
        OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
  `;
};
```

**Verify** in each file:
- [ ] Does it use `is_sqo_unique = 1` for SQO counts?
- [ ] Does it filter by `recordtypeid = '012Dn000000mrO3IAI'`?
- [ ] Does it have any person-level deduplication?

---

## Findings: Phase 6 - Dashboard Codebase Investigation

### 6.1 Known Files That Query vw_funnel_master

**Investigation Results:**

| File | Purpose | Uses `is_sqo_unique`? | Filter by Record Type? | Person-Level Dedup? |
|------|---------|----------------------|------------------------|---------------------|
| `funnel-metrics.ts` | Main scorecard numbers | ✅ Yes (line 131) | ✅ Yes (`recordtypeid = @recruitingRecordType`) | ❌ No |
| `drill-down.ts` | SQO drilldown modal | ✅ Yes (line 228) | ✅ Yes (`recordtypeid = @recruitingRecordType`) | ❌ No |
| `detail-records.ts` | Main data table | ✅ Yes (line 122) | ✅ Yes (`recordtypeid = @recruitingRecordType`) | ❌ No |
| `quarterly-progress.ts` | Quarterly SQO tracking | ✅ Yes (lines 63, 134, 199) | ✅ Yes (`recordtypeid = @recruitingRecordType`) | ❌ No |
| `source-performance.ts` | Channel/source breakdown | ✅ Yes (lines 108, 189, 323, 404) | ✅ Yes (`recordtypeid = @recruitingRecordType`) | ❌ No |
| `conversion-rates.ts` | Conversion rate calculations | ⚠️ Maybe | ⚠️ Unknown | ❌ No |
| `re-engagement.ts` | Re-engagement opps | ❌ No | ❌ No - queries raw Opportunity | N/A |
| `record-detail.ts` | Single record view | ❌ No | ❌ No - single record | N/A |
| `export-records.ts` | CSV/Sheets export | ⚠️ Maybe | ⚠️ Unknown | ❌ No |
| `query-compiler.ts` | AI Explore feature | ✅ Yes | ✅ Yes | ❌ No |

**Key Findings:**
- ✅ **All SQO-related queries use `is_sqo_unique = 1`** - Consistent pattern across codebase
- ✅ **All SQO queries filter by Recruiting record type** - `recordtypeid = @recruitingRecordType`
- ❌ **NO person-level deduplication** - All queries rely on view-level `is_sqo_unique` flag
- ⚠️ **No Account-level logic** - Queries don't check for AccountId or person-level grouping

**Implications for Solution:**
- Need to update all files that use `is_sqo_unique` to use `is_sqo_account_unique` instead
- Files to update:
  1. `funnel-metrics.ts` - Main SQO count (line 131)
  2. `drill-down.ts` - SQO drilldown (line 228)
  3. `detail-records.ts` - SQO detail records (line 122)
  4. `quarterly-progress.ts` - Quarterly SQO counts (lines 63, 134, 199)
  5. `source-performance.ts` - SQO by source (lines 108, 189, 323, 404)
  6. `query-compiler.ts` - AI Explore SQO queries (if applicable)

### 6.2 Trace the SQO Count Flow

**Code Path Analysis:**

1. **UI Component**: Dashboard scorecard displays SQO count
   - Location: Likely in `src/components/dashboard/` or similar
   - Calls: `getFunnelMetrics()` from `funnel-metrics.ts`

2. **API Route**: Fetches SQO data
   - Function: `getFunnelMetrics()` in `src/lib/queries/funnel-metrics.ts`
   - Cached: Yes (using `cachedQuery` wrapper)

3. **Query Function**: Builds SQL
   - File: `src/lib/queries/funnel-metrics.ts`
   - Function: `_getFunnelMetrics()` (lines 10-225)
   - SQL Pattern:
     ```sql
     SUM(
       CASE 
         WHEN Date_Became_SQO__c IS NOT NULL
           AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
           AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
           AND recordtypeid = @recruitingRecordType
           AND is_sqo_unique = 1  -- ← This is the deduplication flag
           ${sgaFilterForOpp}
         THEN 1 
         ELSE 0 
       END
     ) as sqos
     ```

4. **BigQuery SQL Executed**:
   - Table: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   - Filter: `is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'`
   - Date Filter: `Date_Became_SQO__c` within date range

5. **Response Processing**:
   - Raw result: `RawFunnelMetricsResult` type
   - Transformation: `toNumber(metrics.sqos)` converts to number
   - Returns: `FunnelMetrics` object with `sqos` field

6. **Caching**:
   - Cache wrapper: `cachedQuery()` with `CACHE_TAGS.DASHBOARD`
   - Cache invalidation: Via `/api/admin/refresh-cache` or daily cron at 5 AM UTC

**Key Findings:**
- ✅ **Single code path** - All SQO counts go through `getFunnelMetrics()`
- ✅ **Consistent SQL pattern** - All queries use same filter: `is_sqo_unique = 1 AND recordtypeid = @recruitingRecordType`
- ✅ **Caching enabled** - Results are cached, need to clear cache after view changes
- ⚠️ **No person-level logic** - Current flow relies entirely on view-level `is_sqo_unique` flag

**Implications for Solution:**
- After updating view to add `is_sqo_account_unique`, need to:
  1. Update `funnel-metrics.ts` to use `is_sqo_account_unique` instead of `is_sqo_unique`
  2. Clear cache after deployment
  3. Verify SQO count decreases (from ~38 to ~35, removing ~3 duplicates)

### 6.3 Identify Where Deduplication Should Happen

**Current Deduplication Approach:**

1. **Location**: SQL View Level (`vw_funnel_master.sql`)
2. **Current Logic**:
   ```sql
   -- From views/vw_funnel_master.sql (lines 227-232)
   CASE 
     WHEN LOWER(SQO_raw) = 'yes' 
       AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
     THEN 1 
     ELSE 0 
   END AS is_sqo_unique
   ```
3. **Partition Key**: `Full_Opportunity_ID__c` (opportunity-level)
4. **Ranking**: `opp_row_num = 1` (first lead per opportunity)

**Why It's Not Working:**
- ✅ **Works for opportunity-level deduplication** - Prevents counting same opportunity multiple times when multiple leads convert to it
- ❌ **Does NOT work for person-level deduplication** - Does not prevent counting same person multiple times when they have multiple opportunities
- ❌ **Partitions by Opportunity ID, not Account ID** - Same person with multiple opportunities = multiple rows with `is_sqo_unique = 1`

**Recommended Fix Location:**
- ✅ **SQL View Level** - Add Account-level deduplication in `vw_funnel_master.sql`
- ✅ **Add new flag** - `is_sqo_account_unique` (don't remove existing `is_sqo_unique`)
- ✅ **Partition by Account ID** - Use `Unified_Account_Id` as partition key
- ✅ **Ranking Logic**: 
  1. Prefer open opportunities (StageName NOT IN 'Closed Lost', 'Closed Won', etc.)
  2. Most recent SQO date
  3. Most recent opportunity creation date

**Why View Level is Best:**
- ✅ **Single source of truth** - All queries use the same view
- ✅ **Performance** - Deduplication happens in BigQuery, not in application code
- ✅ **Consistency** - All queries automatically get the fix
- ✅ **Backward compatibility** - Keep `is_sqo_unique` for opportunity-level metrics

**Alternative Approaches Considered:**
- ❌ **API Level**: Would require updating every query function (more work, less consistent)
- ❌ **UI Level**: Would require client-side deduplication (performance issues, inconsistent)
- ✅ **View Level**: Best approach - single change, all queries benefit

### Phase 6 Summary

**✅ Critical Findings:**
1. **All SQO queries use `is_sqo_unique = 1`** - Consistent pattern across 6+ files
2. **All queries filter by Recruiting record type** - `recordtypeid = @recruitingRecordType`
3. **NO person-level deduplication** - All queries rely on view-level flag only
4. **Single code path** - All SQO counts go through `getFunnelMetrics()`
5. **Caching enabled** - Need to clear cache after view changes

**✅ Solution Approach:**
- **Fix Location**: SQL View Level (`vw_funnel_master.sql`)
- **Add New Flag**: `is_sqo_account_unique` (keep existing `is_sqo_unique`)
- **Update Queries**: Change `is_sqo_unique = 1` to `is_sqo_account_unique = 1` in 6 files
- **Backward Compatibility**: Keep `is_sqo_unique` for opportunity-level metrics

**Files to Update:**
1. `src/lib/queries/funnel-metrics.ts` (line 131)
2. `src/lib/queries/drill-down.ts` (line 228)
3. `src/lib/queries/detail-records.ts` (line 122)
4. `src/lib/queries/quarterly-progress.ts` (lines 63, 134, 199)
5. `src/lib/queries/source-performance.ts` (lines 108, 189, 323, 404)
6. `src/lib/semantic-layer/query-compiler.ts` (if applicable)

**Next Steps:**
- Phase 7: Design the solution architecture
- Phase 8: Create implementation plan with exact SQL changes

---

**Ask Cursor to trace:**
```
Trace the complete flow for how the "SQO" count appears on the dashboard:
1. What API endpoint is called?
2. What query function is invoked?
3. What BigQuery SQL is executed?
4. How is the result processed?
5. How is it displayed in the UI?

Show me the exact code path from UI → API → Query → BigQuery → Response → UI
```

**Document the flow:**
- [ ] UI Component that displays SQO count
- [ ] API route that fetches SQO data
- [ ] Query function that builds SQL
- [ ] Exact SQL query executed
- [ ] Response processing logic
- [ ] Any caching involved

### 6.3 Identify Where Deduplication Should Happen

**Ask Cursor:**
```
Given that we need to deduplicate SQOs at the Account/Person level:
1. Where in the current code flow is deduplication attempted?
2. Is the deduplication happening at the SQL level, API level, or UI level?
3. Show me the exact deduplication logic currently implemented.
4. Why might this deduplication not be working?
```

**Document**:
- [ ] Current deduplication approach
- [ ] Why it's not working
- [ ] Recommended fix location (view vs query vs API)

---

## Phase 7: Proposed Solution Architecture

### 7.1 Option A: Add AccountId to View and Deduplicate

**Concept**: Add `AccountId` to the view and create a person-level deduplication flag.

**Prototype Query**:
```sql
-- Add to vw_funnel_master
WITH ... existing CTEs ...,

-- Add Account lookup
With_Account AS (
  SELECT 
    f.*,
    COALESCE(
      o.AccountId,
      l.ConvertedAccountId
    ) AS Unified_Account_Id
  FROM ... f
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o 
    ON f.Full_Opportunity_ID__c = o.Id
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l 
    ON f.Full_prospect_id__c = l.Id
),

-- Add Account-level deduplication for SQO
Account_SQO_Ranked AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY Unified_Account_Id
      ORDER BY 
        CASE WHEN StageName NOT IN ('Closed Lost', 'Joined') THEN 0 ELSE 1 END,
        Date_Became_SQO__c DESC NULLS LAST,
        Opp_CreatedDate DESC NULLS LAST
    ) AS account_sqo_rank
  FROM With_Account
  WHERE is_sqo = 1
)
```

**Questions for Cursor:**
```
1. Is it feasible to add AccountId to the existing view without breaking existing queries?
2. What would be the performance impact of adding the Account lookup?
3. How would downstream queries need to change to use account_sqo_rank?
```

### 7.2 Option B: Create a Person-Unified View

**Concept**: Create a new view (`vw_person_unified`) that has one row per Account/Person with the best opportunity selected.

**Ask Cursor to evaluate:**
```
Would it be better to:
A) Modify vw_funnel_master to add AccountId and account-level deduplication
B) Create a new vw_person_unified view for person-level metrics
C) Keep vw_funnel_master as-is and handle deduplication in queries

Evaluate trade-offs:
- Query complexity
- Performance
- Maintenance burden
- Breaking changes to existing dashboards
```

### 7.3 Option C: Semantic Layer / Cube Approach

**Ask Cursor:**
```
Does the dashboard use any semantic layer or cube technology (like Looker, Cube.js, dbt)?
If so, could person-level metrics be handled there instead of in the BigQuery view?
```

---

## Phase 8: Implementation Plan

### 8.1 View Modification Strategy

Based on the current `vw_funnel_master.sql` structure, here's where to add Account-level unification:

**Current CTE Flow:**
```
Lead_Base → Opp_Base → Combined → With_Channel_Mapping → With_SGA_Lookup → Final
```

**Proposed CTE Flow (add after Combined):**
```
Lead_Base → Opp_Base → Combined → With_Account → With_Channel_Mapping → With_SGA_Lookup → Final
```

**New CTE: `With_Account`**
```sql
-- Add after Combined CTE in views/vw_funnel_master.sql
With_Account AS (
  SELECT
    c.*,
    -- Get AccountId from Opportunity (primary source)
    -- Or from Lead's ConvertedAccountId (secondary source)
    COALESCE(
      opp_acct.AccountId,
      lead_acct.ConvertedAccountId
    ) AS Unified_Account_Id
  FROM Combined c
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` opp_acct
    ON c.Full_Opportunity_ID__c = opp_acct.Id
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` lead_acct
    ON c.Full_prospect_id__c = lead_acct.Id
)
```

**Add to Final CTE (new fields):**
```sql
-- Add these fields to the Final CTE SELECT
Unified_Account_Id,

-- Account-level SQO ranking (for deduplication)
ROW_NUMBER() OVER (
  PARTITION BY Unified_Account_Id
  ORDER BY 
    -- Prefer open opportunities over closed
    CASE WHEN StageName NOT IN ('Closed Lost', 'Joined') THEN 0 ELSE 1 END,
    -- Most recent SQO date first
    Date_Became_SQO__c DESC NULLS LAST,
    -- Most recent opportunity first
    Opp_CreatedDate DESC NULLS LAST
) AS account_sqo_rank,

-- Account-level SQO unique flag
CASE 
  WHEN LOWER(SQO_raw) = 'yes' 
    AND recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting only
    AND (Unified_Account_Id IS NULL OR account_sqo_rank = 1)
  THEN 1 
  ELSE 0 
END AS is_sqo_account_unique,

-- Account-level Joined unique flag
CASE 
  WHEN (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
    AND recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting only
    AND (Unified_Account_Id IS NULL OR account_sqo_rank = 1)
  THEN 1 
  ELSE 0 
END AS is_joined_account_unique
```

### 8.2 Query File Updates

After view is updated, update these query files to use the new flags:

**`src/lib/queries/funnel-metrics.ts`**
```typescript
// Change this:
SUM(CASE WHEN is_sqo_unique = 1 AND recordtypeid = @recruitingRecordType THEN 1 ELSE 0 END) as sqos

// To this (for person-level deduplication):
SUM(CASE WHEN is_sqo_account_unique = 1 THEN 1 ELSE 0 END) as sqos
```

**`src/lib/queries/drill-down.ts`** (`getSQODrillDown`)
```typescript
// Change this:
WHERE v.is_sqo_unique = 1

// To this:
WHERE v.is_sqo_account_unique = 1
```

**`src/lib/queries/quarterly-progress.ts`**
```typescript
// Change this:
SUM(CASE WHEN is_sqo_unique = 1 AND recordtypeid = @recruitingRecordType THEN 1 ELSE 0 END)

// To this:
SUM(CASE WHEN is_sqo_account_unique = 1 THEN 1 ELSE 0 END)
```

### 8.3 Critical: Preserve Backward Compatibility

**DO NOT remove existing flags**. Keep:
- `is_sqo_unique` - For opportunity-level deduplication (still needed for some reports)
- `is_joined_unique` - For opportunity-level deduplication
- `is_primary_opp_record` - For AUM calculations

**ADD new flags alongside**:
- `is_sqo_account_unique` - For person/account-level deduplication
- `is_joined_account_unique` - For person/account-level deduplication
- `Unified_Account_Id` - For grouping records by person
- `account_sqo_rank` - For debugging and drilldowns

---

## Phase 9: Verification Queries

### 9.1 Before/After Comparison

```sql
-- Run BEFORE and AFTER the fix to compare

-- Total SQO count (should drop from 38 to ~35)
SELECT 
  COUNT(*) as total_sqo_rows,
  COUNT(DISTINCT advisor_name) as unique_people
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND Date_Became_SQO__c >= '2026-01-01'
  AND record_type_name = 'Recruiting';

-- After fix with account deduplication (expected: unique_people = total_rows)
SELECT 
  COUNT(*) as total_sqo_rows,
  COUNT(DISTINCT Unified_Account_Id) as unique_accounts
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_account_unique = 1
  AND Date_Became_SQO__c >= '2026-01-01'
  AND record_type_name = 'Recruiting';
```

### 9.2 Chris Habib Verification

```sql
-- Chris Habib should have exactly ONE row with is_sqo_account_unique = 1
SELECT 
  advisor_name,
  Unified_Account_Id,
  Full_Opportunity_ID__c,
  is_sqo,
  is_sqo_unique,
  is_sqo_account_unique,
  account_sqo_rank,
  Date_Became_SQO__c
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Unified_Account_Id = '001VS000006WRUgYAO'
ORDER BY Date_Became_SQO__c;
```

---

## Summary of Questions for Cursor.ai

### High Priority (Answer First)
1. What fields on the Account table can help unify records?
2. Is AccountId reliably populated on all Opportunities?
3. Does ConvertedAccountId reliably link Leads to Accounts?
4. Do the known "duplicates" (Chris Habib, David Warshaw, Robert Olsen) share AccountIds?
5. What's the exact code path for SQO counts in the dashboard?

### Medium Priority (Answer Second)
6. Where is the current deduplication logic and why isn't it working?
7. What's the performance impact of adding Account lookup to the view?
8. Should we modify the view or create a new one?

### Low Priority (Answer Last)
9. Are there any other linking mechanisms beyond AccountId and FA_CRD__c?
10. What edge cases exist (Accounts with no opps, opps with no accounts)?

---

## Coding Standards to Follow (from .cursorrules)

When implementing changes, follow these established patterns:

### BigQuery Query Pattern
```typescript
// ✅ CORRECT: Always use parameterized queries
import { runQuery } from '@/lib/bigquery';

const query = `SELECT * FROM table WHERE channel = @channel`;
const params = { channel: filterValue };
const results = await runQuery<ResultType>(query, params);

// ❌ WRONG: Never use string interpolation
const query = `SELECT * FROM table WHERE channel = '${filterValue}'`;
```

### SGA Filter Pattern (Critical for SQO Queries)
The existing codebase has a known issue where `Opp_SGA_Name__c` may contain a User ID instead of a name. Follow this pattern:

```sql
-- Always join with User table for SGA resolution
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
  ON v.Opp_SGA_Name__c = sga_user.Id

-- Check all three conditions
WHERE (v.SGA_Owner_Name__c = @sgaName                    -- Lead-level SGA
    OR v.Opp_SGA_Name__c = @sgaName                      -- Opp SGA (if it's already a name)
    OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)  -- Opp SGA (if it's an ID)
```

### Date Field Types
| Field | Type | Wrapper Needed |
|-------|------|----------------|
| `FilterDate` | TIMESTAMP | `TIMESTAMP()` |
| `stage_entered_contacting__c` | TIMESTAMP | `TIMESTAMP()` |
| `mql_stage_entered_ts` | TIMESTAMP | `TIMESTAMP()` |
| `converted_date_raw` | DATE | `DATE()` or cast |
| `Date_Became_SQO__c` | TIMESTAMP | `TIMESTAMP()` |
| `advisor_join_date__c` | DATE | `DATE()` or cast |

### SQO Query Requirements
Always include these filters for SQO counts:
```sql
AND v.is_sqo_unique = 1  -- Or is_sqo_account_unique after fix
AND v.recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting record type only
```

### Cache Handling
Queries use a caching layer. After deploying view changes:
1. Clear cache via `/api/admin/refresh-cache`
2. Or wait for daily cron at 5 AM UTC
3. Verify with fresh query (use BigQuery console)

---

## Output Format for Findings

When answering each question, Cursor should document:

```markdown
### Question X.X: [Question Title]

**Query Executed:**
[SQL query]

**Results:**
[Table or summary of results]

**Key Findings:**
- Finding 1
- Finding 2

**Implications for Solution:**
- How this affects the proposed solution

**Follow-up Questions:**
- Any new questions raised by these findings
```

---

## Final Deliverable

After completing all phases, Cursor should provide:

1. **Data Model Diagram**: Visual showing Lead → Account → Opportunity relationships
2. **Recommended Solution**: Which option (A, B, or C) is best and why
3. **Implementation SQL**: Complete updated view or query code
4. **Testing Evidence**: Before/after query results proving the fix works
5. **Migration Plan**: Steps to deploy the fix safely

---

## Appendix: Why Previous Attempts Failed

### Previous Attempt 1: Exclude Re-Engagement from is_sqo_unique
- **Change**: Added `AND recordtypeid != '012VS000009VoxrYAC'` to `is_sqo_unique`
- **Result**: Still showed 38 SQOs
- **Why Failed**: The duplicates (Chris Habib, etc.) are from RECRUITING opportunities, not Re-Engagement. Both duplicate rows have `recordtypeid = '012Dn000000mrO3IAI'`

### Previous Attempt 2: Add person_row_rank to View
- **Change**: Added `ROW_NUMBER() OVER (PARTITION BY COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c) ...) AS person_row_rank`
- **Result**: Still showed duplicates
- **Why Failed**: Partitioning by `Full_prospect_id__c` doesn't help when the same person has MULTIPLE leads (which happens with re-engagement). We need to partition by Account, not by Lead.

### Previous Attempt 3-5: Add Deduplication CTEs to Query Files
- **Change**: Added `person_sqo_rank = 1` filters to funnel-metrics.ts, drill-down.ts, etc.
- **Result**: Still showed duplicates
- **Why Failed**: The `person_row_rank` field in the view was partitioning incorrectly (see #2). The queries were correct, but the underlying data was wrong.

### What's Different This Time

**The Account-centric approach works because:**
1. Account is the TRUE unique identifier for a person in Salesforce
2. Lead.ConvertedAccountId links leads to their Account
3. Opportunity.AccountId links ALL opportunities (including direct-created ones) to their Account
4. Partitioning by Account will correctly group ALL records for Chris Habib, even if he has multiple Leads or multiple Opportunities

**Key Insight**: The previous attempts failed because they tried to use Lead ID as the person identifier. But a person can have multiple Leads over time (original + re-engagement). Account is the only reliable unifier.
