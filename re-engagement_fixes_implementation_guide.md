# Re-Engagement Fixes & Enhancements — Agentic Implementation Guide

> **Execution**: Deploys via Salesforce CLI (`sf project deploy start`), validation queries via Salesforce MCP (`run_soql_query`)
> **SF CLI Alias**: `savvy` (russell.moss@savvywealth.com, connected)
> **Org**: `russell.moss@savvywealth.com` (Production)
> **SFDX Project Root**: `C:\Users\russe\Documents\Dashboard\salesforce`
> **Working Directory for all `sf` commands**: `C:\Users\russe\Documents\Dashboard\salesforce`
> **Predecessor**: `re-engagement_implementation_guide.md` (Phases 1–5 complete)
> **Source exploration**: `re-engagement_fix.md` (investigation findings)

---

## Overview

Three workstreams, six phases:

| # | Workstream | What | Why |
|---|-----------|------|-----|
| Phase 1 | Flow bug fix | Add `StageName != 'Closed Lost'` to Screen Flow Record Lookup | 205 Closed Lost re-engagement opps incorrectly block repeat re-engagement |
| Phase 2 | Account rollup: total re-engagement opps | New rollup `Total_Re_Engagement_Opps__c` on Account (COUNT of all Re-Engagement opps, any stage) | Powers the "Was Re-Engaged" formula |
| Phase 3 | Account rollup: most recent closed date | New rollup `Most_Recent_Closed_Date__c` on Account (MAX of `Stage_Entered_Closed__c` where Closed Lost) | Powers the updated Days Since Closed Lost formula |
| Phase 4 | Opportunity formula fields | New `Was_Re_Engaged__c` + update `Days_Since_Closed_Lost__c` to use account-level most recent date | List view columns: "Was Re-Engaged" + accurate days for repeat re-engagements |
| Phase 5 | List view + permission set | Add new columns, update permission set, assign to SGAs | SGAs see new columns |
| Phase 6 | End-to-end validation | SOQL spot-checks + manual UI tests | Confirm everything works |

---

## Decisions

| Question | Decision |
|----------|----------|
| Flow fix method | Retrieve flow metadata via CLI, add filter, redeploy as new version |
| "Was Re-Engaged" logic | Account-level rollup counting ALL re-engagement opps (any stage) → formula IF > 0 then "Yes" else "No" |
| Days Since Closed Lost | Use account-level MAX(Stage_Entered_Closed__c) across all Closed Lost opps (Recruiting + Re-Engagement). Fallback to opp's own dates when rollup is null |
| SGA visibility | Assign `Re_Engagement_Fields_Access` permission set to all active SGA users |

---

## Existing Assets (from exploration)

| Asset | Key Finding |
|-------|------------|
| Screen Flow `Create_Re_Engagement_Opportunity` (v16) | Record Lookup `Get_Open_ReEngagement_Opportunities` only excludes `StageName != 'Re-Engaged'` — **missing `!= 'Closed Lost'`** |
| Account rollup `Open_Re_Engagement_Opps__c` | Correctly excludes Closed Lost + Re-Engaged (no fix needed) |
| Re-Engagement opps | 864 total: 617 open, 205 Closed Lost (blocked), 42 Re-Engaged |
| `Stage_Entered_Closed__c` | DateTime, 42.5% null on pre-mid-2024 records. Always populated on newer records |
| Permission set `Re_Engagement_Fields_Access` | Currently assigned only to russell.moss@savvywealth.com |

---

## Phase 1: Fix Screen Flow — Add Closed Lost Exclusion

**Method**: Salesforce CLI (`sf project retrieve start` + modify XML + `sf project deploy start`)
**Risk**: Medium — flow metadata is complex XML. Dry-run validation is critical.

### Step 1.1: Retrieve current flow metadata

```bash
sf project retrieve start \
  --metadata Flow:Create_Re_Engagement_Opportunity \
  --target-org savvy \
  --output-dir force-app \
  --wait 10
```

This will write the flow XML to:
`force-app/main/default/flows/Create_Re_Engagement_Opportunity.flow-meta.xml`

### Step 1.2: Inspect the flow XML

Read the retrieved XML. Find the `<recordLookups>` element with `<name>Get_Open_ReEngagement_Opportunities</name>`.

Locate its `<filters>` section. You should see a filter like:
```xml
<filters>
    <field>StageName</field>
    <operator>NotEqualTo</operator>
    <value>
        <stringValue>Re-Engaged</stringValue>
    </value>
</filters>
```

### Step 1.3: Add the Closed Lost exclusion filter

Add a NEW `<filters>` block immediately after the existing StageName filter, inside the same `<recordLookups>` element:

```xml
<filters>
    <field>StageName</field>
    <operator>NotEqualTo</operator>
    <value>
        <stringValue>Closed Lost</stringValue>
    </value>
</filters>
```

**Do NOT modify any other part of the flow XML.** The only change is adding this one filter block.

### Step 1.4: Deploy — dry-run first

**Step 1.4a — Dry-run validation**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/flows/Create_Re_Engagement_Opportunity.flow-meta.xml \
  --target-org savvy \
  --dry-run \
  --wait 10
```

> **⚠️ STOP** — Report dry-run results to the user. If the dry-run fails, report the EXACT error. Flow metadata is sensitive — do not attempt to fix errors without user approval.

**Step 1.4b — Actual deploy** (only after dry-run succeeds and user approves):

```bash
sf project deploy start \
  --source-dir force-app/main/default/flows/Create_Re_Engagement_Opportunity.flow-meta.xml \
  --target-org savvy \
  --wait 10
```

### Step 1.5: Verify new flow version

```sql
-- Tooling API
SELECT Id, Definition.DeveloperName, VersionNumber, Status
FROM Flow
WHERE Definition.DeveloperName = 'Create_Re_Engagement_Opportunity'
ORDER BY VersionNumber DESC
LIMIT 2
```

Confirm:
- [ ] New version number is v17 (or v16 + 1)
- [ ] Status = Active

### Validation Gate 1
- [ ] Dry-run succeeded
- [ ] Deploy succeeded
- [ ] New flow version is Active
- [ ] **Do NOT test by creating a re-engagement opp yet** — wait until all phases are complete

---

## Phase 2: Create Account Rollup — Total Re-Engagement Opps

**Method**: Salesforce CLI
**Object**: Account (not Opportunity)
**Why**: Powers the "Was Re-Engaged" formula. Counts ALL re-engagement opps regardless of stage.

### Step 2.1: Create directory structure for Account fields

```bash
mkdir -p force-app/main/default/objects/Account/fields
```

### Step 2.2: Create `Total_Re_Engagement_Opps__c` (Rollup Summary)

**File**: `force-app/main/default/objects/Account/fields/Total_Re_Engagement_Opps__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Total_Re_Engagement_Opps__c</fullName>
    <label>Total Re-Engagement Opps</label>
    <type>Summary</type>
    <summaryOperation>count</summaryOperation>
    <summaryForeignKey>Opportunity.AccountId</summaryForeignKey>
    <summaryFilterItems>
        <field>Opportunity.RecordTypeId</field>
        <operation>equals</operation>
        <value>Re-Engagement</value>
    </summaryFilterItems>
    <description>Total count of all Re-Engagement Opportunities on this Account, regardless of stage. Used to determine if an advisor was previously re-engaged.</description>
    <inlineHelpText>Total number of Re-Engagement Opportunities ever created for this advisor (any stage).</inlineHelpText>
</CustomField>
```

**Notes**:
- `type` = `Summary` (rollup summary field)
- `summaryOperation` = `count` (count all matching opps)
- Filter: only Re-Engagement record type, NO stage filter (we want all stages)
- `summaryForeignKey` = `Opportunity.AccountId` (standard Account-Opportunity relationship)
- The `value` for RecordTypeId filter should use the Record Type name `Re-Engagement` — Salesforce resolves this to the correct ID during deploy

> **⚠️ Rollup Summary Deploy Note**: If the deploy fails because Salesforce doesn't recognize the RecordType name in the filter, try using the RecordType DeveloperName `Re_Engagement` or the actual RecordTypeId `012VS000009VoxrYAC` instead. Report the error before attempting alternatives.

### Step 2.3: Deploy — dry-run first

**Step 2.3a — Dry-run**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Account/fields/Total_Re_Engagement_Opps__c.field-meta.xml \
  --target-org savvy \
  --dry-run \
  --wait 10
```

> **⚠️ STOP** — Report dry-run results. Only proceed with user approval.

**Step 2.3b — Actual deploy**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Account/fields/Total_Re_Engagement_Opps__c.field-meta.xml \
  --target-org savvy \
  --wait 10
```

### Validation Gate 2

Verify the rollup is working:

```sql
SELECT Id, Name, Total_Re_Engagement_Opps__c, Open_Re_Engagement_Opps__c
FROM Account
WHERE Id = '001VS000006IHqAYAW'
```

Expected for Alejandro Rubinstein's account:
- `Total_Re_Engagement_Opps__c` = 1 (one re-engagement opp exists, Closed Lost)
- `Open_Re_Engagement_Opps__c` = 0 (it's closed, so not counted as open)

Also verify an account with no re-engagement opps:

```sql
SELECT Id, Name, Total_Re_Engagement_Opps__c
FROM Account
WHERE Id IN (
  SELECT AccountId FROM Opportunity
  WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
)
AND Total_Re_Engagement_Opps__c = 0
LIMIT 3
```

- [ ] Rollup returns correct counts
- [ ] Accounts with no re-engagement opps show 0

---

## Phase 3: Create Account Rollup — Most Recent Closed Date

**Method**: Salesforce CLI
**Object**: Account
**Why**: Powers the updated Days Since Closed Lost formula to use the most recent closed date across all opps.

### Step 3.1: Create `Most_Recent_Closed_Date__c` (Rollup Summary)

**File**: `force-app/main/default/objects/Account/fields/Most_Recent_Closed_Date__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Most_Recent_Closed_Date__c</fullName>
    <label>Most Recent Closed Lost Date</label>
    <type>Summary</type>
    <summaryOperation>max</summaryOperation>
    <summarizedField>Opportunity.Stage_Entered_Closed__c</summarizedField>
    <summaryForeignKey>Opportunity.AccountId</summaryForeignKey>
    <summaryFilterItems>
        <field>Opportunity.StageName</field>
        <operation>equals</operation>
        <value>Closed Lost</value>
    </summaryFilterItems>
    <description>Most recent Stage_Entered_Closed__c date across all Closed Lost Opportunities (both Recruiting and Re-Engagement) on this Account. Used to calculate days since the advisor was most recently lost. NULL values are ignored by MAX — for older records where Stage_Entered_Closed__c is null, the formula falls back to the opp's own dates.</description>
    <inlineHelpText>The most recent date any opportunity for this advisor entered Closed Lost stage.</inlineHelpText>
</CustomField>
```

**Notes**:
- `summaryOperation` = `max` (most recent date)
- `summarizedField` = `Opportunity.Stage_Entered_Closed__c` (DateTime)
- Filter: `StageName = 'Closed Lost'` — includes BOTH Recruiting and Re-Engagement record types
- MAX ignores null values — if all opps have null `Stage_Entered_Closed__c`, the rollup returns null and the formula falls back to the opp's own date logic
- No RecordType filter — we want the most recent across ALL record types

### Step 3.2: Deploy — dry-run first

**Step 3.2a — Dry-run**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Account/fields/Most_Recent_Closed_Date__c.field-meta.xml \
  --target-org savvy \
  --dry-run \
  --wait 10
```

> **⚠️ STOP** — Report dry-run results. Only proceed with user approval.

**Step 3.2b — Actual deploy**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Account/fields/Most_Recent_Closed_Date__c.field-meta.xml \
  --target-org savvy \
  --wait 10
```

### Validation Gate 3

Verify the rollup for Alejandro Rubinstein (has Closed Lost re-engagement opp with Stage_Entered_Closed = 2026-02-09):

```sql
SELECT Id, Name, Most_Recent_Closed_Date__c, Total_Re_Engagement_Opps__c
FROM Account
WHERE Id = '001VS000006IHqAYAW'
```

Expected:
- `Most_Recent_Closed_Date__c` = `2026-02-09T21:10:08.000Z` (from the re-engagement opp, not the original recruiting opp's 2024-07-18)

Also check an account with only a recruiting opp (no re-engagement):

```sql
SELECT a.Id, a.Name, a.Most_Recent_Closed_Date__c,
  o.Stage_Entered_Closed__c, o.CloseDate
FROM Account a
JOIN Opportunity o ON o.AccountId = a.Id
WHERE o.RecordType.DeveloperName = 'Recruiting'
  AND o.StageName = 'Closed Lost'
  AND a.Total_Re_Engagement_Opps__c = 0
  AND o.Stage_Entered_Closed__c != null
LIMIT 3
```

> **Note**: If the JOIN query isn't supported by SOQL, use two separate queries — one for Accounts and one for their Opportunities.

- [ ] Rollup returns the most recent date
- [ ] For accounts with re-engagement opps, the rollup date is from the re-engagement opp (not the original)
- [ ] For accounts without re-engagement opps, the rollup date matches the recruiting opp's Stage_Entered_Closed__c

---

## Phase 4: Create/Update Opportunity Formula Fields

**Method**: Salesforce CLI
**Depends on**: Phase 2 (Total_Re_Engagement_Opps__c) and Phase 3 (Most_Recent_Closed_Date__c) must be deployed first

### Step 4.1: Create `Was_Re_Engaged__c` (Formula, Text)

**File**: `force-app/main/default/objects/Opportunity/fields/Was_Re_Engaged__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Was_Re_Engaged__c</fullName>
    <label>Was Re-Engaged</label>
    <type>Text</type>
    <formula>IF(Account.Total_Re_Engagement_Opps__c &gt; 0, &quot;Yes&quot;, &quot;No&quot;)</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <required>false</required>
    <unique>false</unique>
    <externalId>false</externalId>
    <trackHistory>false</trackHistory>
    <description>Indicates whether this advisor has ever had a Re-Engagement Opportunity created (any stage). Based on Account-level Total_Re_Engagement_Opps__c rollup.</description>
    <inlineHelpText>Yes = this advisor was previously re-engaged. No = first-time Closed Lost with no prior re-engagement attempts.</inlineHelpText>
</CustomField>
```

**Notes**:
- BlankAsZero is fine here — if rollup is somehow null, 0 > 0 = false = "No", which is the correct default
- References `Account.Total_Re_Engagement_Opps__c` (cross-object formula)

### Step 4.2: Update `Days_Since_Closed_Lost__c` formula

**File**: `force-app/main/default/objects/Opportunity/fields/Days_Since_Closed_Lost__c.field-meta.xml`

Update the `<formula>` element to use the account-level most recent date with fallback:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Days_Since_Closed_Lost__c</fullName>
    <label>Days Since Closed Lost</label>
    <type>Number</type>
    <precision>18</precision>
    <scale>0</scale>
    <formula>IF(
  ISPICKVAL(StageName, &quot;Closed Lost&quot;),
  TODAY() - DATEVALUE(
    IF(
      NOT(ISBLANK(Account.Most_Recent_Closed_Date__c)),
      Account.Most_Recent_Closed_Date__c,
      IF(
        ISBLANK(Stage_Entered_Closed__c),
        DATETIMEVALUE(TEXT(CloseDate) + &quot; 00:00:00&quot;),
        Stage_Entered_Closed__c
      )
    )
  ),
  NULL
)</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <required>false</required>
    <unique>false</unique>
    <externalId>false</externalId>
    <trackHistory>false</trackHistory>
    <description>Number of days since this advisor was most recently marked Closed Lost (across all opps including Re-Engagement). Uses Account.Most_Recent_Closed_Date__c rollup (MAX Stage_Entered_Closed__c across all Closed Lost opps). Falls back to the opp's own Stage_Entered_Closed__c or CloseDate for accounts where the rollup is null (all Stage_Entered_Closed__c values are null on older records).</description>
    <inlineHelpText>Days since this advisor was most recently closed lost. If the advisor was re-engaged and that also closed lost, this reflects the more recent date.</inlineHelpText>
</CustomField>
```

**Notes**:
- Priority order: (1) Account rollup `Most_Recent_Closed_Date__c`, (2) opp's own `Stage_Entered_Closed__c`, (3) opp's own `CloseDate`
- The rollup handles the cross-opp MAX automatically — for Alejandro Rubinstein, this would show ~36 days (from re-engagement close) instead of 607 (from original recruiting close)
- For accounts with no re-engagement opps where Stage_Entered_Closed__c is populated, the rollup returns the same date as the opp's own field — no behavior change

> **⚠️ Formula Complexity Note**: If this formula hits the Salesforce compiled formula size limit (5,000 chars), simplify the inner fallback: replace the DATETIMEVALUE wrapper with `IF(NOT(ISBLANK(Account.Most_Recent_Closed_Date__c)), Account.Most_Recent_Closed_Date__c, IF(ISBLANK(Stage_Entered_Closed__c), CloseDate, DATEVALUE(Stage_Entered_Closed__c)))`. This requires the outer DATEVALUE to handle mixed Date/DateTime, which may need adjustment.

### Step 4.3: Deploy both fields — dry-run first

**Step 4.3a — Dry-run**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/fields/Was_Re_Engaged__c.field-meta.xml \
  --source-dir force-app/main/default/objects/Opportunity/fields/Days_Since_Closed_Lost__c.field-meta.xml \
  --target-org savvy \
  --dry-run \
  --wait 10
```

> **⚠️ STOP** — Report dry-run results. Only proceed with user approval.

**Step 4.3b — Actual deploy**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/fields/Was_Re_Engaged__c.field-meta.xml \
  --source-dir force-app/main/default/objects/Opportunity/fields/Days_Since_Closed_Lost__c.field-meta.xml \
  --target-org savvy \
  --wait 10
```

### Validation Gate 4

**Test 1 — Alejandro Rubinstein (has Closed Lost re-engagement opp):**

```sql
SELECT Id, Name, Days_Since_Closed_Lost__c, Closed_Lost_Time_Bucket__c, Was_Re_Engaged__c
FROM Opportunity
WHERE Id = '006VS000005janeYAA'
```

Expected:
- `Days_Since_Closed_Lost__c` ≈ 36 (from re-engagement close date 2026-02-09, NOT 607 from original)
- `Closed_Lost_Time_Bucket__c` = "1 month since lost" (not "6+ months since lost")
- `Was_Re_Engaged__c` = "Yes"

**Test 2 — Record with no re-engagement history:**

```sql
SELECT Id, Name, Days_Since_Closed_Lost__c, Was_Re_Engaged__c
FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND AccountId IN (
    SELECT Id FROM Account WHERE Total_Re_Engagement_Opps__c = 0
  )
LIMIT 3
```

Expected:
- `Was_Re_Engaged__c` = "No"
- `Days_Since_Closed_Lost__c` = same as before (no change in behavior)

**Test 3 — Non-Closed-Lost opps still return null:**

```sql
SELECT Id, StageName, Days_Since_Closed_Lost__c, Closed_Lost_Time_Bucket__c, Was_Re_Engaged__c
FROM Opportunity
WHERE StageName != 'Closed Lost' AND RecordType.DeveloperName = 'Recruiting'
LIMIT 3
```

Expected:
- `Days_Since_Closed_Lost__c` = null
- `Closed_Lost_Time_Bucket__c` = null
- `Was_Re_Engaged__c` = "Yes" or "No" (this field shows for all opps — it's account-level, not stage-dependent)

- [ ] Alejandro shows ~36 days, not 607
- [ ] "Was Re-Engaged" shows "Yes" for records with re-engagement history
- [ ] "Was Re-Engaged" shows "No" for records without
- [ ] Non-Closed-Lost opps still show null for Days and Bucket

---

## Phase 5: Update List View + Permission Set + SGA Assignment

**Method**: Salesforce CLI

### Step 5.1: Update list view to add new columns

**File**: `force-app/main/default/objects/Opportunity/listViews/Re_Engagement_Eligible.listView-meta.xml`

Update the `<columns>` section to add `Was_Re_Engaged__c`. Insert it after `SGA__c` and before `Stage_Entered_Closed__c`:

```xml
    <columns>NAME</columns>
    <columns>Opportunity.SGA__c</columns>
    <columns>Was_Re_Engaged__c</columns>
    <columns>Opportunity.Stage_Entered_Closed__c</columns>
    <columns>Opportunity.Days_Since_Closed_Lost__c</columns>
    <columns>Opportunity.Closed_Lost_Time_Bucket__c</columns>
    <columns>Opportunity.SQL__c</columns>
    <columns>Opportunity.Closed_Lost_Reason__c</columns>
    <columns>Opportunity.Closed_Lost_Details__c</columns>
    <columns>Opportunity.Open_Re_Engagement_Opps__c</columns>
    <columns>Opportunity.FA_CRD__c</columns>
```

> **⚠️ Column Reference Format Note**: Use the same format that worked in the previous deployment for custom field column references. In the prior deploy, Claude Code corrected the format to bare API names (e.g., `SQL__c` not `Opportunity.SQL__c`). Use whatever format succeeded in Phase 4 of the original guide. Read the current file to check what format is in use before making changes.

### Step 5.2: Deploy list view — dry-run first

**Step 5.2a — Dry-run**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/listViews/Re_Engagement_Eligible.listView-meta.xml \
  --target-org savvy \
  --dry-run \
  --wait 10
```

> **⚠️ STOP** — Report dry-run results. Only proceed with user approval.

**Step 5.2b — Actual deploy**:

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/listViews/Re_Engagement_Eligible.listView-meta.xml \
  --target-org savvy \
  --wait 10
```

### Step 5.3: Update permission set to include new fields

**File**: `force-app/main/default/permissionsets/Re_Engagement_Fields_Access.permissionset-meta.xml`

Add field permissions for the new fields. Read the current file first to see existing structure, then add:

```xml
    <fieldPermissions>
        <field>Opportunity.Was_Re_Engaged__c</field>
        <editable>false</editable>
        <readable>true</readable>
    </fieldPermissions>
    <fieldPermissions>
        <field>Account.Total_Re_Engagement_Opps__c</field>
        <editable>false</editable>
        <readable>true</readable>
    </fieldPermissions>
    <fieldPermissions>
        <field>Account.Most_Recent_Closed_Date__c</field>
        <editable>false</editable>
        <readable>true</readable>
    </fieldPermissions>
```

Deploy:

```bash
sf project deploy start \
  --source-dir force-app/main/default/permissionsets/Re_Engagement_Fields_Access.permissionset-meta.xml \
  --target-org savvy \
  --wait 10
```

### Step 5.4: Assign permission set to all active SGAs

First, query for active SGA users:

```sql
SELECT Id, Name, Username, Profile.Name, IsActive
FROM User
WHERE IsActive = true
AND (Profile.Name LIKE '%SGA%' OR Profile.Name LIKE '%Sales Growth%' OR UserRole.Name LIKE '%SGA%')
```

> **⚠️ STOP** — Report the list of users found. The user will confirm which users should get the permission set before assignment.

If the query returns no results, try:

```sql
SELECT Id, Name, Username, Profile.Name
FROM User
WHERE IsActive = true
ORDER BY Profile.Name
```

And report the distinct profiles so the user can identify which profile the SGAs use.

After user confirmation, assign the permission set:

```bash
sf org assign permset \
  --name Re_Engagement_Fields_Access \
  --target-org savvy \
  --on-behalf-of user1@savvywealth.com user2@savvywealth.com ...
```

> **Note**: The `--on-behalf-of` flag assigns to specific users. List all confirmed SGA usernames separated by spaces.

### Validation Gate 5
- [ ] List view deploy succeeded
- [ ] Permission set deploy succeeded
- [ ] Permission set assigned to all SGAs
- [ ] `Was_Re_Engaged__c` column appears in list view

---

## Phase 6: End-to-End Validation

### Step 6.1: Full spot-check query

```sql
SELECT
  Name,
  SGA__r.Name,
  Was_Re_Engaged__c,
  Stage_Entered_Closed__c,
  Days_Since_Closed_Lost__c,
  Closed_Lost_Time_Bucket__c,
  SQL__c,
  Closed_Lost_Reason__c,
  Open_Re_Engagement_Opps__c
FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'
ORDER BY Days_Since_Closed_Lost__c ASC
LIMIT 10
```

> **Note**: ORDER BY ASC to see the most recently lost (lowest days) — this is where re-engaged records will appear with their updated lower day counts.

### Step 6.2: Verify re-engaged records have updated days

```sql
SELECT
  o.Name,
  o.Days_Since_Closed_Lost__c,
  o.Was_Re_Engaged__c,
  o.Closed_Lost_Time_Bucket__c,
  a.Most_Recent_Closed_Date__c,
  a.Total_Re_Engagement_Opps__c
FROM Opportunity o
JOIN Account a ON a.Id = o.AccountId
WHERE o.RecordType.DeveloperName = 'Recruiting'
  AND o.StageName = 'Closed Lost'
  AND o.Was_Re_Engaged__c = 'Yes'
LIMIT 5
```

> **Note**: If JOIN syntax isn't supported, query Opportunities first, then query Accounts by Id.

### Step 6.3: Updated bucket distribution

```sql
SELECT Closed_Lost_Time_Bucket__c, COUNT(Id)
FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'
GROUP BY Closed_Lost_Time_Bucket__c
ORDER BY Closed_Lost_Time_Bucket__c
```

### Step 6.4: Manual UI tests (not agentic)

**Test A — Repeat re-engagement (the original bug):**
1. Go to Opportunities → "Re-Engagement Eligible" list view
2. Find Alejandro Rubinstein (006VS000005janeYAA) — should now show ~36 days and "Was Re-Engaged = Yes"
3. Click the record → Run "Create Re-Engagement Opportunity" Screen Flow
4. Confirm it now ALLOWS creation (previously blocked)
5. Complete the flow → verify the new re-engagement opp is created
6. Return to list view → confirm the record disappeared (Open_Re_Engagement_Opps__c now > 0)
7. Delete the test re-engagement opp → confirm the record reappears

**Test B — Still blocks when open re-engagement exists:**
1. Find a record with `Open_Re_Engagement_Opps__c > 0` (not Alejandro since we just tested him)
2. Try to run the Screen Flow → confirm it still blocks with the appropriate message

**Test C — Validation rule still works:**
1. Find a record with `Open_Re_Engagement_Opps__c > 0`
2. Try to check the `Create_Re_Engagement__c` checkbox
3. Confirm the validation rule fires

### Validation Gate 6
- [ ] Alejandro Rubinstein shows ~36 days (not 607) and "Was Re-Engaged = Yes"
- [ ] Screen Flow allows re-engagement for advisors with only Closed Lost re-engagement opps
- [ ] Screen Flow still blocks when truly open re-engagement opps exist
- [ ] Validation rule still fires for checkbox-based creation
- [ ] Bucket distribution looks reasonable
- [ ] List view shows all expected columns

---

## Summary: What Gets Deployed

| Phase | Asset | Object | Type | Deploy Method |
|-------|-------|--------|------|--------------|
| 1 | `Create_Re_Engagement_Opportunity` | Flow | Flow (v17) — added Closed Lost exclusion | CLI |
| 2 | `Total_Re_Engagement_Opps__c` | Account | Rollup Summary (COUNT) | CLI |
| 3 | `Most_Recent_Closed_Date__c` | Account | Rollup Summary (MAX DateTime) | CLI |
| 4 | `Was_Re_Engaged__c` | Opportunity | Formula Field (Text) | CLI |
| 4 | `Days_Since_Closed_Lost__c` | Opportunity | Formula Field (Number) — updated | CLI |
| 5 | `Re_Engagement_Eligible` | Opportunity | List View — updated columns | CLI |
| 5 | `Re_Engagement_Fields_Access` | — | Permission Set — updated + assigned | CLI |

---

## Rollback Plan

If any phase fails or produces unexpected results:

1. **Flow**: Reactivate v16 via Setup → Flows → `Create_Re_Engagement_Opportunity` → Activate v16
2. **Account rollup fields**: Delete via Setup → Object Manager → Account → Fields → Delete (Note: must remove formula field references first)
3. **Was_Re_Engaged__c**: Delete via Setup → Object Manager → Opportunity → Fields → Delete
4. **Days_Since_Closed_Lost__c**: Redeploy the previous version of the formula XML (the version from the original guide, before this update)
5. **List view**: Redeploy previous version without the Was_Re_Engaged__c column
6. **Permission set**: No rollback needed — additional permissions are non-breaking

**Dependency order for rollback**: Remove Opportunity formulas first (Was_Re_Engaged, Days_Since_Closed_Lost revert), then Account rollups. The formulas reference the rollups, so rollups can't be deleted while formulas reference them.

All changes are additive except the Days_Since_Closed_Lost__c formula update and the flow modification. Keep the previous formula XML as a backup before deploying Phase 4.
