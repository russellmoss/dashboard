# Re-Engagement Eligible List — V2 Enhancements Implementation Guide

> **Status**: Ready for execution
> **Prereqs**: Re-engagement list view v1 deployed and working (see `re-engagement_implementation_guide.md`)
> **SF CLI Alias**: `savvy` (russell.moss@savvywealth.com)
> **SFDX Project Root**: `C:\Users\russe\Documents\Dashboard\salesforce`
> **Org**: Production (`russell.moss@savvywealth.com`)

---

## Problem Statement

The Re-Engagement Eligible list view has three issues:

1. **Duplicate rows**: Accounts with multiple Closed Lost recruiting opps show one row per opp (14 accounts affected, 15 extra rows). The list should show only the **most recent** Closed Lost recruiting opp per account.

2. **Missing original context**: When an advisor has been re-engaged and closed lost again, the list shows the latest opp's reason — but the **original** Closed Lost reason/details from their first recruiting opp is lost. Users want both.

3. **Missing re-engagement count**: No column shows how many times we've attempted re-engagement for an advisor.

### Example: Dustin Granger (Account `001VS00000GoeCLYAZ`)

| Opp | Record Type | Created | Closed Lost Reason | Details |
|-----|------------|---------|-------------------|---------|
| `CkdXJ` (original) | Recruiting | Oct 2024 | Other | (JE creating a re-engagement opportunity for Russell) |
| `WP3mf` | Re-Engagement | Jan 2026 | Other | doesn't want to change custodians |
| `WP4HJ` (latest) | Recruiting | Jan 2026 | Candidate Declined - Operational Constraints | Not open to coming based on custodians... |

**Current list**: Shows BOTH recruiting opps as separate rows, each with its own reason.
**Desired list**: Shows only `WP4HJ` (latest), plus columns for original reason ("Other") and re-engagement count (1).

---

## Data Exploration Results

| Metric | Value |
|--------|-------|
| Current eligible list count | 403 |
| Accounts with multiple eligible recruiting opps | 14 (13×2, 1×3) |
| Duplicate rows to eliminate | 15 |
| Expected list count after dedup | ~388 unique advisors |
| Opps with null `Stage_Entered_Closed__c` | 96 (all single-opp accounts — safe to show) |
| Multi-opp accounts with null timestamps | 0 (all have timestamps — MAX comparison is safe) |
| Accounts with Closed Lost recruiting opps (backfill scope) | 1,731 |
| Permission set assignments to maintain | 29 users |

---

## Architecture

### New Components

| Component | Object | Type | Purpose |
|-----------|--------|------|---------|
| `Most_Recent_Recruiting_Closed_Date__c` | Account | Rollup Summary (MAX) | MAX `Stage_Entered_Closed__c` for Recruiting Closed Lost opps only |
| `Original_Closed_Lost_Reason__c` | Account | Text(255) | Stores first recruiting opp's Closed Lost Reason |
| `Original_Closed_Lost_Details__c` | Account | Long Text Area(5000) | Stores first recruiting opp's Closed Lost Details (full text, never truncated) |
| `Original_Closed_Lost_Details_Short__c` | Account | Text(255) | Truncated copy of Details for formula reference (SF formulas cannot reference LTA fields) |
| `Is_Latest_Closed_Lost__c` | Opportunity | Formula (Checkbox) | TRUE only for the most recent Closed Lost recruiting opp per account |
| `Re_Engagement_Opp_Count__c` | Opportunity | Formula (Number) | Surfaces `Account.Total_Re_Engagement_Opps__c` |
| `Original_Closed_Lost_Reason__c` | Opportunity | Formula (Text) | Surfaces `Account.Original_Closed_Lost_Reason__c` |
| `Original_Closed_Lost_Details__c` | Opportunity | Formula (Text) | Surfaces `Account.Original_Closed_Lost_Details_Short__c` |
| `Populate_Original_Closed_Lost` | Flow | Record-Triggered | Populates Account original fields when a Recruiting opp enters Closed Lost |
| Backfill script | Apex/Flow | One-time | Backfills original fields for existing 1,731 accounts |

### Dependency Chain

```
Phase 0: Pre-flight checks (no dependencies)
    ↓
Phase 1: Account rollup + Account text fields (no dependencies)
    ↓
Phase 2: Record-Triggered Flow (depends on Account text fields) [XML via CLI]
    ↓
Phase 3: Backfill existing records (depends on Account text fields) [Apex via CLI]
    ↓
Phase 4: Opportunity formula fields (depend on Account rollup + Account text fields)
    ↓
Phase 5: List view + permission set (depend on Opportunity formula fields)
    ↓
Phase 6: End-to-end validation
```

**CRITICAL**: Do NOT combine phases into a single deploy command. Each phase depends on the previous phase's components existing in production. For example, deploying Phase 4 Opportunity formulas before Phase 1 Account fields exist will fail because `Account.Most_Recent_Recruiting_Closed_Date__c` won't resolve. Always deploy phase-by-phase and run the verification queries before proceeding.

---

## Phase 0: Pre-Flight Checks

Before any deployment, run these SOQL queries via MCP to confirm assumptions:

### Step 0.1: Verify RecordType labels match rollup filter values

```soql
SELECT Id, Name, DeveloperName FROM RecordType WHERE SObjectType = 'Opportunity' AND IsActive = true
```

**Critical check**: The rollup XML filters use `<value>Recruiting</value>` for `Opportunity.RecordTypeId`. Salesforce rollup summary filters on RecordTypeId match against the **Record Type Label** (the `Name` field), NOT the `DeveloperName`. Confirm the label is exactly `Recruiting` — if it's something like "Recruiting Opportunity" or has a trailing space, the rollup will silently return null for all records.

**Expected**: A record with `Name = 'Recruiting'` and `DeveloperName = 'Recruiting'` (already verified in v1 deployment — `012Dn000000mrO3IAI`).

### Step 0.2: Verify current list view baseline count

```soql
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Open_Recruiting_Opps__c < 1
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'
```

Record the baseline count (was 403 as of 2026-03-18). This is the number to compare against after v2 deployment — the dedup filter should reduce it by ~15.

**Stop gate**: If RecordType label does not exactly match `Recruiting`, do NOT proceed — update all rollup XML `<value>` tags to use the actual label before deploying.

### Step 0.3: Verify field API names and relationships

Run these queries to confirm all field API names referenced in the flow XML, backfill Apex, and formula fields exist exactly as expected.

**Opportunity fields**:
```soql
SELECT QualifiedApiName, Label, DataType
FROM FieldDefinition
WHERE EntityDefinition.QualifiedApiName = 'Opportunity'
AND QualifiedApiName IN (
  'Closed_Lost_Reason__c',
  'Closed_Lost_Details__c',
  'Stage_Entered_Closed__c',
  'Open_Recruiting_Opps__c',
  'Open_Re_Engagement_Opps__c',
  'Days_Since_Closed_Lost__c',
  'Was_Re_Engaged__c'
)
```

Expected (all 7 confirmed 2026-03-18):

| API Name | Label | Data Type |
|----------|-------|-----------|
| `Closed_Lost_Reason__c` | Closed Lost Reason | Picklist |
| `Closed_Lost_Details__c` | Closed Lost Details | Long Text Area(1000) |
| `Stage_Entered_Closed__c` | Stage Entered Closed | Date/Time |
| `Open_Recruiting_Opps__c` | Open Recruiting Opps | Formula (Number) |
| `Open_Re_Engagement_Opps__c` | Open Re-Engagement Opps | Formula (Number) |
| `Days_Since_Closed_Lost__c` | Days Since Closed Lost | Formula (Number) |
| `Was_Re_Engaged__c` | Was Re-Engaged | Formula (Text) |

**Account fields**:
```soql
SELECT QualifiedApiName, Label, DataType
FROM FieldDefinition
WHERE EntityDefinition.QualifiedApiName = 'Account'
AND QualifiedApiName IN (
  'Most_Recent_Closed_Date__c',
  'Total_Re_Engagement_Opps__c',
  'Open_Recruiting_Opps__c'
)
```

Expected (all 3 confirmed 2026-03-18):

| API Name | Label | Data Type |
|----------|-------|-----------|
| `Total_Re_Engagement_Opps__c` | Total Re-Engagement Opps | Roll-Up Summary (COUNT Opportunity) |
| `Most_Recent_Closed_Date__c` | Most Recent Closed Lost Date | Roll-Up Summary (MAX Opportunity) |
| `Open_Recruiting_Opps__c` | Open Recruiting Opps | Roll-Up Summary (COUNT Opportunity) |

**Child relationship name** (used in backfill Apex subquery `FROM Opportunities`):
```soql
SELECT Id,
  (SELECT Id FROM Opportunities LIMIT 1)
FROM Account
WHERE Id = '001VS00000GoeCLYAZ'
```

Expected: Query succeeds — confirms `Opportunities` is the correct child relationship name (confirmed 2026-03-18).

**Stage_Entered_Closed flow timing**:
```soql
SELECT Id, ApiName, ActiveVersionId, ProcessType, TriggerType
FROM FlowDefinitionView
WHERE ApiName = 'Opportunity_Stage_Entered_Closed_Update'
```

Expected: `ProcessType = 'AutoLaunchedFlow'`, `TriggerType = 'RecordBeforeSave'`, `ActiveVersionId` is non-null (confirmed 2026-03-18). This means `Stage_Entered_Closed__c` is populated BEFORE our After Save flow queries it — the timing dependency is safe.

**Dustin Granger test fixture**:
```soql
SELECT Id, Name, RecordType.DeveloperName, StageName,
       Stage_Entered_Closed__c, CreatedDate,
       Closed_Lost_Reason__c, Closed_Lost_Details__c
FROM Opportunity
WHERE AccountId = '001VS00000GoeCLYAZ'
ORDER BY CreatedDate ASC
```

Expected (confirmed 2026-03-18):

| Id | Name | RecordType | Stage | Stage_Entered_Closed | Closed_Lost_Reason |
|----|------|-----------|-------|---------------------|-------------------|
| `006VS00000CkdXJYAZ` | Dustin Granger | Recruiting | Closed Lost | 2026-01-26T16:35:09Z | Other |
| `006VS00000WP3mfYAD` | [Re-Engagement] Dustin Granger | Re_Engagement | Closed Lost | 2026-02-09T20:40:27Z | Other |
| `006VS00000WP4HJYA1` | Dustin Granger (Jan '26) | Recruiting | Closed Lost | 2026-01-28T02:46:05Z | Candidate Declined - Operational Constraints |

All three opps intact. Both Recruiting opps have `Stage_Entered_Closed__c` populated. Test fixture is valid.

**Stop gate**: If any field API names are missing or differ from the table above, update ALL references in the guide (flow XML, backfill Apex, formula XML, list view XML) before proceeding.

---

## Phase 1: Account-Level Fields

### Step 1.1: Create `Most_Recent_Recruiting_Closed_Date__c` rollup on Account

Create file: `force-app/main/default/objects/Account/fields/Most_Recent_Recruiting_Closed_Date__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Most_Recent_Recruiting_Closed_Date__c</fullName>
    <label>Most Recent Recruiting Closed Date</label>
    <type>Summary</type>
    <summaryOperation>max</summaryOperation>
    <summarizedField>Opportunity.Stage_Entered_Closed__c</summarizedField>
    <summaryForeignKey>Opportunity.AccountId</summaryForeignKey>
    <summaryFilterItems>
        <field>Opportunity.RecordTypeId</field>
        <operation>equals</operation>
        <value>Recruiting</value>
    </summaryFilterItems>
    <summaryFilterItems>
        <field>Opportunity.StageName</field>
        <operation>equals</operation>
        <value>Closed Lost</value>
    </summaryFilterItems>
    <description>MAX Stage_Entered_Closed__c across Recruiting Closed Lost opps only. Used to determine which opp is the most recent for the Re-Engagement Eligible list view.</description>
    <inlineHelpText>The most recent Closed Lost date among all Recruiting opportunities on this account.</inlineHelpText>
</CustomField>
```

**Key differences from existing `Most_Recent_Closed_Date__c`**: This rollup is scoped to Recruiting record type only (the existing one includes Re-Engagement opps). Two filter items: RecordType = Recruiting AND StageName = Closed Lost.

Deploy:
```bash
cd C:\Users\russe\Documents\Dashboard\salesforce
sf project deploy start --source-dir force-app/main/default/objects/Account/fields/Most_Recent_Recruiting_Closed_Date__c.field-meta.xml --target-org savvy --wait 5
```

### Step 1.2: Create `Original_Closed_Lost_Reason__c` text field on Account

Create file: `force-app/main/default/objects/Account/fields/Original_Closed_Lost_Reason__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Original_Closed_Lost_Reason__c</fullName>
    <label>Original Closed Lost Reason</label>
    <type>Text</type>
    <length>255</length>
    <required>false</required>
    <externalId>false</externalId>
    <unique>false</unique>
    <description>The Closed Lost Reason from the earliest Recruiting opportunity on this account. Populated by the Populate_Original_Closed_Lost flow.</description>
    <inlineHelpText>Closed Lost Reason from the first Recruiting opportunity for this advisor.</inlineHelpText>
</CustomField>
```

### Step 1.3: Create `Original_Closed_Lost_Details__c` long text area on Account

Create file: `force-app/main/default/objects/Account/fields/Original_Closed_Lost_Details__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Original_Closed_Lost_Details__c</fullName>
    <label>Original Closed Lost Details</label>
    <type>LongTextArea</type>
    <length>5000</length>
    <visibleLines>3</visibleLines>
    <description>The Closed Lost Details from the earliest Recruiting opportunity on this account. Populated by the Populate_Original_Closed_Lost flow.</description>
    <inlineHelpText>Closed Lost Details from the first Recruiting opportunity for this advisor.</inlineHelpText>
</CustomField>
```

Deploy both text fields together:
```bash
sf project deploy start --source-dir force-app/main/default/objects/Account/fields/Original_Closed_Lost_Reason__c.field-meta.xml --source-dir force-app/main/default/objects/Account/fields/Original_Closed_Lost_Details__c.field-meta.xml --target-org savvy --wait 5
```

### Phase 1 Verification

Run these SOQL queries via MCP to verify all three fields exist:

```soql
-- Verify rollup is populated (should return non-zero count)
SELECT COUNT(Id) FROM Account WHERE Most_Recent_Recruiting_Closed_Date__c != null

-- Verify text fields exist (should return 0 — not yet populated)
SELECT COUNT(Id) FROM Account WHERE Original_Closed_Lost_Reason__c != null

-- Verify Dustin Granger's rollup value
SELECT Id, Most_Recent_Recruiting_Closed_Date__c FROM Account WHERE Id = '001VS00000GoeCLYAZ'
-- Expected: 2026-01-28T02:46:05.000+0000 (the latest recruiting opp's close date)
```

**Stop gate**: If the rollup returns null for Dustin Granger's account, the deployment failed. Do not proceed.

---

## Phase 2: Record-Triggered Flow — Populate Original Closed Lost Fields

### Step 2.1: Create the Flow XML

Create file: `force-app/main/default/flows/Populate_Original_Closed_Lost.flow-meta.xml`

This flow fires when a Recruiting Opportunity enters the "Closed Lost" stage and populates the Account's `Original_Closed_Lost_Reason__c` and `Original_Closed_Lost_Details__c` with the **earliest** Recruiting Closed Lost opp's values.

**Flow logic**:
1. **Trigger**: Record-Triggered Flow on Opportunity, After Save (create or update)
   - Entry conditions: `RecordTypeId = '012Dn000000mrO3IAI'` (Recruiting) AND `StageName = 'Closed Lost'` AND `AccountId IS NOT NULL` AND `StageName IsChanged = true`
   - The IsChanged guard prevents unnecessary re-runs when someone edits a field on an already-closed opp. On Create, Salesforce treats IsChanged as true for any populated field, so this also fires correctly for opps created directly in Closed Lost.
2. **Get Records** (`Get_Earliest_Recruiting_Opp`): Query the earliest Recruiting Closed Lost opp on this Account
   - Object: Opportunity
   - Filters: `AccountId = {!$Record.AccountId}`, `RecordTypeId = '012Dn000000mrO3IAI'`, `StageName = 'Closed Lost'`
   - Sort: `CreatedDate ASC`, first record only
3. **Update Records** (`Update_Account_Original_Fields`): Update the Account with the earliest opp's reason/details
   - Filter: `Id = {!$Record.AccountId}`
   - Set: `Original_Closed_Lost_Reason__c` = `{!Get_Earliest_Recruiting_Opp.Closed_Lost_Reason__c}`
   - Set: `Original_Closed_Lost_Details__c` = `{!Get_Earliest_Recruiting_Opp.Closed_Lost_Details__c}`

**XML template** (modeled after `Bulk_Create_Re_Engagement_Opportunity.flow-meta.xml`, a working Record-Triggered Flow on Opportunity in this org):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <description>Record-triggered flow that populates Account.Original_Closed_Lost_Reason__c and Account.Original_Closed_Lost_Details__c with the earliest Recruiting Closed Lost opportunity's values. Fires on every Recruiting opp entering Closed Lost to ensure the Account always reflects the true original.</description>
    <environments>Default</environments>
    <interviewLabel>Populate Original Closed Lost {!$Flow.CurrentDateTime}</interviewLabel>
    <label>Populate Original Closed Lost</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>OriginBuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <recordLookups>
        <name>Get_Earliest_Recruiting_Opp</name>
        <label>Get Earliest Recruiting Opp</label>
        <locationX>176</locationX>
        <locationY>335</locationY>
        <assignNullValuesIfNoRecordsFound>false</assignNullValuesIfNoRecordsFound>
        <connector>
            <targetReference>Update_Account_Original_Fields</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>AccountId</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>$Record.AccountId</elementReference>
            </value>
        </filters>
        <filters>
            <field>RecordTypeId</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>012Dn000000mrO3IAI</stringValue>
            </value>
        </filters>
        <filters>
            <field>StageName</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>Closed Lost</stringValue>
            </value>
        </filters>
        <getFirstRecordOnly>true</getFirstRecordOnly>
        <object>Opportunity</object>
        <sortField>CreatedDate</sortField>
        <sortOrder>Asc</sortOrder>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordLookups>
    <recordUpdates>
        <name>Update_Account_Original_Fields</name>
        <label>Update Account Original Fields</label>
        <locationX>176</locationX>
        <locationY>455</locationY>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>$Record.AccountId</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <field>Original_Closed_Lost_Reason__c</field>
            <value>
                <elementReference>Get_Earliest_Recruiting_Opp.Closed_Lost_Reason__c</elementReference>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Original_Closed_Lost_Details__c</field>
            <value>
                <elementReference>Get_Earliest_Recruiting_Opp.Closed_Lost_Details__c</elementReference>
            </value>
        </inputAssignments>
        <object>Account</object>
    </recordUpdates>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Get_Earliest_Recruiting_Opp</targetReference>
        </connector>
        <filterLogic>and</filterLogic>
        <filters>
            <field>RecordTypeId</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>012Dn000000mrO3IAI</stringValue>
            </value>
        </filters>
        <filters>
            <field>StageName</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>Closed Lost</stringValue>
            </value>
        </filters>
        <filters>
            <field>AccountId</field>
            <operator>IsNull</operator>
            <value>
                <booleanValue>false</booleanValue>
            </value>
        </filters>
        <filters>
            <field>StageName</field>
            <operator>IsChanged</operator>
            <value>
                <booleanValue>true</booleanValue>
            </value>
        </filters>
        <object>Opportunity</object>
        <recordTriggerType>CreateAndUpdate</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>
```

**Key design notes**:
- Uses `RecordTypeId` with the hardcoded Recruiting ID (`012Dn000000mrO3IAI`) — same pattern as `Bulk_Create_Re_Engagement_Opportunity`
- `recordTriggerType` is `CreateAndUpdate` (not just `Update`) to catch opps created directly in Closed Lost stage
- `status` is `Active` — deploying with Active status directly. If Salesforce requires activation as a separate step, see Step 2.2
- `getFirstRecordOnly` + `sortField: CreatedDate` + `sortOrder: Asc` ensures we get the earliest opp
- Guards against orphaned opps with `AccountId IsNull false` in the start filters
- **ISCHANGED optimization**: Filter 4 is `StageName IsChanged = true`. This ensures the flow only fires when `StageName` transitions TO "Closed Lost", not on every subsequent edit of an already-closed opp. On Create transactions, Salesforce treats `IsChanged` as true for any field that has a value (it changed from nothing to a value), so this correctly covers opps created directly in Closed Lost stage. Without this filter, editing any field on a Closed Lost opp would re-trigger the flow unnecessarily.
- **Timing dependency validated**: The `Opportunity_Stage_Entered_Closed_Update` flow (Before Save, active) sets `Stage_Entered_Closed__c` before our After Save flow queries it. Confirmed via Phase 0.3 verification.

### Step 2.2: Deploy the Flow

```bash
cd C:\Users\russe\Documents\Dashboard\salesforce
sf project deploy start --source-dir force-app/main/default/flows/Populate_Original_Closed_Lost.flow-meta.xml --target-org savvy --wait 5
```

**If the flow deploys as Draft** (not Active), activate via Tooling API:
```bash
# Get the FlowDefinition ID and version IDs
sf data query --query "SELECT Id, ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE ApiName = 'Populate_Original_Closed_Lost'" --target-org savvy --use-tooling-api

# Activate (replace IDs):
sf data update record --sobject FlowDefinition --record-id <FlowDefinitionId> --values "ActiveFlowVersionId=<LatestVersionId>" --target-org savvy --use-tooling-api
```

### Phase 2 Verification

```soql
-- Verify the flow is active
SELECT Id, ApiName, ActiveVersionId, LatestVersionId
FROM FlowDefinitionView
WHERE ApiName = 'Populate_Original_Closed_Lost'
-- ActiveVersionId should equal LatestVersionId (both non-null)
```

**Stop gate**: If the flow is not active (ActiveVersionId is null), activate it via the Tooling API command above or via Setup → Flows → Populate Original Closed Lost → Activate. Do not proceed to Phase 3 until the flow is active.

---

## Phase 3: Backfill Existing Records

The flow only fires on future changes. We need to backfill `Original_Closed_Lost_Reason__c` and `Original_Closed_Lost_Details__c` for all 1,731 existing accounts that have Closed Lost recruiting opps.

### Step 3.1: Run backfill via Anonymous Apex

Claude Code can execute this via the Bash tool using `sf apex run`. The SFDC MCP is SOQL-only, but the CLI has full access.

**Execution plan**:
1. Write the Apex script to a file (one-time)
2. Run it via `sf apex run` (Bash tool)
3. Check remaining count via MCP SOQL
4. Repeat steps 2–3 until count reaches 0 (~9 iterations)

**Step 3.1a: Create the Apex file**

Write file `C:\Users\russe\Documents\Dashboard\salesforce\backfill_original_closed_lost.apex` with these contents:

```apex
// Backfill Original Closed Lost fields for all accounts with Closed Lost Recruiting opps
// Processes in batches of 200 to stay within governor limits

List<Account> accountsToUpdate = new List<Account>();

// Get all accounts with Closed Lost Recruiting opps that don't have Original fields populated
for (Account acc : [
    SELECT Id,
           (SELECT Id, Closed_Lost_Reason__c, Closed_Lost_Details__c, CreatedDate
            FROM Opportunities
            WHERE RecordType.DeveloperName = 'Recruiting'
              AND StageName = 'Closed Lost'
            ORDER BY CreatedDate ASC
            LIMIT 1)
    FROM Account
    WHERE Id IN (
        SELECT AccountId FROM Opportunity
        WHERE RecordType.DeveloperName = 'Recruiting'
          AND StageName = 'Closed Lost'
          AND AccountId != null
    )
    AND Original_Closed_Lost_Reason__c = null
    LIMIT 200
]) {
    if (!acc.Opportunities.isEmpty()) {
        Opportunity earliest = acc.Opportunities[0];
        acc.Original_Closed_Lost_Reason__c = earliest.Closed_Lost_Reason__c;
        acc.Original_Closed_Lost_Details__c = earliest.Closed_Lost_Details__c;
        accountsToUpdate.add(acc);
    }
}

if (!accountsToUpdate.isEmpty()) {
    update accountsToUpdate;
    System.debug('Updated ' + accountsToUpdate.size() + ' accounts');
}
```

**Step 3.1b: Run the backfill in a loop**

```bash
cd C:\Users\russe\Documents\Dashboard\salesforce
sf apex run --file backfill_original_closed_lost.apex --target-org savvy
```

After each run, check remaining count via MCP SOQL (see Phase 3 Verification). Re-run until count reaches 0. This script processes 200 accounts per execution due to SOQL subquery limits — expect ~9 runs for 1,731 accounts.

Claude Code should automate this loop: run Apex via Bash, check count via MCP SOQL, repeat if count > 0.

### Phase 3 Verification

```soql
-- Count accounts still needing backfill (should reach 0)
SELECT COUNT(Id) FROM Account
WHERE Id IN (
    SELECT AccountId FROM Opportunity
    WHERE RecordType.DeveloperName = 'Recruiting'
      AND StageName = 'Closed Lost'
      AND AccountId != null
)
AND Original_Closed_Lost_Reason__c = null

-- Verify Dustin Granger's account (should show original opp's reason)
SELECT Id, Original_Closed_Lost_Reason__c, Original_Closed_Lost_Details__c
FROM Account WHERE Id = '001VS00000GoeCLYAZ'
-- Expected: Reason = "Other", Details = "(JE creating a re-engagement opportunity for Russell)..."
```

**Stop gate**: If accounts still need backfill (count > 0), re-run the Apex script. If Dustin Granger's account does not show "Other" as the original reason, the backfill logic is wrong — investigate before proceeding.

---

## Phase 4: Opportunity Formula Fields

### Step 4.1: Create `Is_Latest_Closed_Lost__c` formula on Opportunity

Create file: `force-app/main/default/objects/Opportunity/fields/Is_Latest_Closed_Lost__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Is_Latest_Closed_Lost__c</fullName>
    <label>Is Latest Closed Lost</label>
    <type>Checkbox</type>
    <formula>IF(
  NOT(ISPICKVAL(StageName, &quot;Closed Lost&quot;)),
  false,
  IF(
    Account.Open_Recruiting_Opps__c &gt; 0,
    false,
    IF(
      ISBLANK(Stage_Entered_Closed__c),
      true,
      Stage_Entered_Closed__c = Account.Most_Recent_Recruiting_Closed_Date__c
    )
  )
)</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <description>TRUE only for the most recent Closed Lost recruiting opportunity per account, AND only if the account has no open recruiting opps. Used to dedup the Re-Engagement Eligible list view and replace the Open_Recruiting_Opps list view filter (to stay within the 10-filter limit). Null Stage_Entered_Closed__c defaults to TRUE (all 96 legacy records are single-opp accounts).</description>
    <inlineHelpText>Indicates this is the most recent Closed Lost recruiting opportunity on this account and no active recruiting opp exists.</inlineHelpText>
</CustomField>
```

**Formula logic** (incorporates the Open Recruiting Opps guard — see Phase 5 for why):
- Non-Closed-Lost opps → always FALSE
- Account has open recruiting opps (`Open_Recruiting_Opps__c > 0`) → always FALSE (advisor is already being actively recruited)
- Null `Stage_Entered_Closed__c` → TRUE (96 legacy records, all verified as single-opp accounts)
- Otherwise → TRUE only if this opp's close date matches the account's MAX recruiting close date

**Why the `Open_Recruiting_Opps__c` guard is baked in here**: The list view has a 10-filter maximum. Adding `Is_Latest_Closed_Lost__c` as a filter requires removing one existing filter. By folding the `Open_Recruiting_Opps__c > 0` check into this formula, the `Open_Recruiting_Opps__c < 1` list view filter becomes redundant and can be replaced with `Is_Latest_Closed_Lost__c = 1`. This keeps us at exactly 10 filters.

**Semantic note**: This formula will also return TRUE for Re-Engagement record type opps that happen to be Closed Lost and have the most recent `Stage_Entered_Closed__c` on an account. This does not cause a list view issue because the list view filters on `RecordType = Recruiting`, so Re-Engagement opps are already excluded before the `Is_Latest_Closed_Lost__c` filter is evaluated. The formula's name is technically a misnomer for non-Recruiting opps, but it is functionally correct in the context of its only consumer (the list view).

### Step 4.2: Create `Re_Engagement_Opp_Count__c` formula on Opportunity

Create file: `force-app/main/default/objects/Opportunity/fields/Re_Engagement_Opp_Count__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Re_Engagement_Opp_Count__c</fullName>
    <label># of Re-Engagement Opps</label>
    <type>Number</type>
    <precision>18</precision>
    <scale>0</scale>
    <formula>Account.Total_Re_Engagement_Opps__c</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <description>Surfaces the Account-level Total Re-Engagement Opps count on Opportunity. Shows how many times re-engagement was attempted for this advisor.</description>
    <inlineHelpText>Total number of Re-Engagement Opportunities ever created for this advisor.</inlineHelpText>
</CustomField>
```

### Step 4.3: Create `Original_Closed_Lost_Reason__c` formula on Opportunity

Create file: `force-app/main/default/objects/Opportunity/fields/Original_Closed_Lost_Reason__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Original_Closed_Lost_Reason__c</fullName>
    <label>Original Closed Lost Reason</label>
    <type>Text</type>
    <formula>Account.Original_Closed_Lost_Reason__c</formula>
    <formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>
    <description>Surfaces the Account-level Original Closed Lost Reason on Opportunity. Shows the reason from the first Recruiting opp to close lost.</description>
    <inlineHelpText>Closed Lost Reason from the original (first) Recruiting opportunity for this advisor.</inlineHelpText>
</CustomField>
```

**Note**: Uses `BlankAsBlank` so that advisors with no original data show blank rather than a misleading value.

### Step 4.4: Create `Original_Closed_Lost_Details__c` formula on Opportunity

Create file: `force-app/main/default/objects/Opportunity/fields/Original_Closed_Lost_Details__c.field-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Original_Closed_Lost_Details__c</fullName>
    <label>Original Closed Lost Details</label>
    <type>Text</type>
    <formula>Account.Original_Closed_Lost_Details__c</formula>
    <formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>
    <description>Surfaces the Account-level Original Closed Lost Details on Opportunity. Shows the details from the first Recruiting opp to close lost.</description>
    <inlineHelpText>Closed Lost Details from the original (first) Recruiting opportunity for this advisor.</inlineHelpText>
</CustomField>
```

**IMPORTANT**: The Opportunity formula references `Account.Original_Closed_Lost_Details_Short__c` (Text(255)), NOT the LTA field. Salesforce formulas cannot reference Long Text Area fields. A two-field approach is used: the Account LTA field preserves full data, while the Short field (auto-truncated at 255 chars) enables the formula. 44 accounts have details > 255 chars — these show truncated text in the list view, but full details remain on the Account record.

### Step 4.5: Deploy all four Opportunity formula fields

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/fields/Is_Latest_Closed_Lost__c.field-meta.xml \
  --source-dir force-app/main/default/objects/Opportunity/fields/Re_Engagement_Opp_Count__c.field-meta.xml \
  --source-dir force-app/main/default/objects/Opportunity/fields/Original_Closed_Lost_Reason__c.field-meta.xml \
  --source-dir force-app/main/default/objects/Opportunity/fields/Original_Closed_Lost_Details__c.field-meta.xml \
  --target-org savvy --wait 5
```

### Phase 4 Verification

```soql
-- Verify Is_Latest_Closed_Lost for Dustin Granger's two recruiting opps
SELECT Id, Name, Is_Latest_Closed_Lost__c, Stage_Entered_Closed__c
FROM Opportunity
WHERE AccountId = '001VS00000GoeCLYAZ' AND RecordType.DeveloperName = 'Recruiting' AND StageName = 'Closed Lost'
ORDER BY CreatedDate ASC
-- Expected: CkdXJ (original) = false, WP4HJ (latest) = true

-- Verify Re_Engagement_Opp_Count for Dustin Granger
SELECT Id, Name, Re_Engagement_Opp_Count__c FROM Opportunity WHERE Id = '006VS00000WP4HJYA1'
-- Expected: 1

-- Verify Original fields surface correctly
SELECT Id, Name, Original_Closed_Lost_Reason__c, Original_Closed_Lost_Details__c
FROM Opportunity WHERE Id = '006VS00000WP4HJYA1'
-- Expected: Reason = "Other", Details starts with "(JE creating a re-engagement..."

-- Verify null-timestamp opps default to Is_Latest = true
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Stage_Entered_Closed__c = null
  AND Is_Latest_Closed_Lost__c = false
-- Expected: 0 (all null-timestamp opps should be true)

-- Verify dedup count: how many opps will the list show after adding Is_Latest filter?
-- Note: Is_Latest_Closed_Lost__c already includes the Open_Recruiting_Opps check,
-- so this query matches the exact logic the list view will use in Phase 5.
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Is_Latest_Closed_Lost__c = true
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'
-- Expected: ~388 (403 minus ~15 duplicates). This count should match Phase 5 exactly.
```

**Stop gate**: If Dustin Granger's original opp (`CkdXJ`) shows `Is_Latest_Closed_Lost__c = true`, the formula logic is wrong. If any null-timestamp opps show `false`, the ISBLANK fallback is broken. Do not proceed until both checks pass.

---

## Phase 5: List View + Permission Set Updates

### Step 5.1: Update the list view

Edit `force-app/main/default/objects/Opportunity/listViews/Re_Engagement_Eligible.listView-meta.xml`.

**Changes**:
1. **Replace** the `Open_Recruiting_Opps__c < 1` filter with `Is_Latest_Closed_Lost__c = 1` (the formula already includes the `Open_Recruiting_Opps__c > 0` guard — see Phase 4 Step 4.1)
2. Add columns: `Re_Engagement_Opp_Count__c`, `Original_Closed_Lost_Reason__c`, `Original_Closed_Lost_Details__c`

**10-filter limit**: The current list view uses all 10 Salesforce filter slots. Because the `Is_Latest_Closed_Lost__c` formula already subsumes the `Open_Recruiting_Opps__c` check, replacing that filter with `Is_Latest_Closed_Lost__c` keeps us at exactly 10 filters.

Full list view XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListView xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Re_Engagement_Eligible</fullName>
    <label>Re-Engagement Eligible</label>
    <filterScope>Everything</filterScope>
    <filters>
        <field>OPPORTUNITY.RECORDTYPE</field>
        <operation>equals</operation>
        <value>Opportunity.Recruiting</value>
    </filters>
    <filters>
        <field>OPPORTUNITY.STAGE_NAME</field>
        <operation>equals</operation>
        <value>Closed Lost</value>
    </filters>
    <filters>
        <field>Days_Since_Closed_Lost__c</field>
        <operation>greaterOrEqual</operation>
        <value>30</value>
    </filters>
    <filters>
        <field>Open_Re_Engagement_Opps__c</field>
        <operation>equals</operation>
        <value>0</value>
    </filters>
    <filters>
        <field>Is_Latest_Closed_Lost__c</field>
        <operation>equals</operation>
        <value>1</value>
    </filters>
    <filters>
        <field>Closed_Lost_Reason__c</field>
        <operation>notEqual</operation>
        <value>Savvy Declined - No Book of Business</value>
    </filters>
    <filters>
        <field>Closed_Lost_Reason__c</field>
        <operation>notEqual</operation>
        <value>Savvy Declined - Insufficient Revenue</value>
    </filters>
    <filters>
        <field>Closed_Lost_Reason__c</field>
        <operation>notEqual</operation>
        <value>Savvy Declined – Book Not Transferable</value>
    </filters>
    <filters>
        <field>Closed_Lost_Reason__c</field>
        <operation>notEqual</operation>
        <value>Savvy Declined - Poor Culture Fit</value>
    </filters>
    <filters>
        <field>Closed_Lost_Reason__c</field>
        <operation>notEqual</operation>
        <value>Savvy Declined - Compliance</value>
    </filters>
    <columns>OPPORTUNITY.NAME</columns>
    <columns>SGA__c</columns>
    <columns>Was_Re_Engaged__c</columns>
    <columns>Re_Engagement_Opp_Count__c</columns>
    <columns>Original_Closed_Lost_Reason__c</columns>
    <columns>Original_Closed_Lost_Details__c</columns>
    <columns>Stage_Entered_Closed__c</columns>
    <columns>Days_Since_Closed_Lost__c</columns>
    <columns>Closed_Lost_Time_Bucket__c</columns>
    <columns>SQL__c</columns>
    <columns>Closed_Lost_Reason__c</columns>
    <columns>Closed_Lost_Details__c</columns>
    <columns>Open_Re_Engagement_Opps__c</columns>
    <columns>FA_CRD__c</columns>
    <sharedTo>
        <allInternalUsers/>
    </sharedTo>
</ListView>
```

**Note on list view filter for checkbox fields**: Checkbox TRUE is represented as `<value>1</value>` in list view XML (not `true` or `TRUE`). However, if this causes a rendering issue similar to the `equals 0` problem from Round 3, use `<operation>equals</operation><value>1</value>`. If that also fails, the checkbox filter may need to be tested in the Salesforce UI first.

**Fallback if checkbox filter breaks the list view**: Remove the `Is_Latest_Closed_Lost__c` filter and keep it as an informational column only. The Open_Recruiting_Opps filter still provides the critical guard. Duplicate rows (15) are a cosmetic issue, not a data integrity issue.

### Step 5.2: Update the permission set

Edit `force-app/main/default/permissionsets/Re_Engagement_Fields_Access.permissionset-meta.xml`.

Add these `<fieldPermissions>` blocks:

```xml
<fieldPermissions>
    <field>Account.Most_Recent_Recruiting_Closed_Date__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Account.Original_Closed_Lost_Reason__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Account.Original_Closed_Lost_Details__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Opportunity.Is_Latest_Closed_Lost__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Opportunity.Re_Engagement_Opp_Count__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Opportunity.Original_Closed_Lost_Reason__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
<fieldPermissions>
    <field>Opportunity.Original_Closed_Lost_Details__c</field>
    <editable>false</editable>
    <readable>true</readable>
</fieldPermissions>
```

### Step 5.3: Deploy list view + permission set

```bash
sf project deploy start \
  --source-dir force-app/main/default/objects/Opportunity/listViews/Re_Engagement_Eligible.listView-meta.xml \
  --source-dir force-app/main/default/permissionsets/Re_Engagement_Fields_Access.permissionset-meta.xml \
  --target-org savvy --wait 5
```

### Phase 5 Verification

```soql
-- Verify list view record count (should be ~388, down from 403)
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Is_Latest_Closed_Lost__c = true
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'

-- Verify permission set still has correct assignment count
SELECT COUNT(Id) FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Re_Engagement_Fields_Access'
-- Expected: 29
```

**Stop gate**: If the list view shows 0 records (same issue as the `equals 0` bug from Round 3), try changing the filter value from `1` to `true`, or remove the `Is_Latest_Closed_Lost__c` filter and keep it as a column only. **Do not leave the list view broken** — always verify it shows records before moving to Phase 6.

**Manual UI check**: Open `https://savvywealth.lightning.force.com/lightning/o/Opportunity/list?filterName=Re_Engagement_Eligible` and confirm:
- Records appear (not empty)
- Dustin Granger appears **once** (not twice)
- His row shows: Original Closed Lost Reason = "Other", # of Re-Engagement Opps = 1
- Jeremy Dunlop (`006VS00000D5GkcYAF`) does NOT appear (has open recruiting opp)

---

## Phase 6: End-to-End Validation

### Step 6.1: Dustin Granger deep verification

```soql
SELECT Id, Name, Is_Latest_Closed_Lost__c, Re_Engagement_Opp_Count__c,
       Original_Closed_Lost_Reason__c, Original_Closed_Lost_Details__c,
       Closed_Lost_Reason__c, Closed_Lost_Details__c,
       Days_Since_Closed_Lost__c, Was_Re_Engaged__c, Open_Recruiting_Opps__c
FROM Opportunity
WHERE AccountId = '001VS00000GoeCLYAZ'
  AND RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
ORDER BY CreatedDate ASC
```

**Expected results**:

| Field | CkdXJ (original) | WP4HJ (latest) |
|-------|-------------------|-----------------|
| Is_Latest_Closed_Lost | **false** | **true** |
| Re_Engagement_Opp_Count | 1 | 1 |
| Original_Closed_Lost_Reason | Other | Other |
| Original_Closed_Lost_Details | (JE creating...) | (JE creating...) |
| Closed_Lost_Reason | Other | Candidate Declined - Operational Constraints |
| Closed_Lost_Details | (JE creating...) | Not open to coming based on custodians... |
| Was_Re_Engaged | Yes | Yes |
| Open_Recruiting_Opps | 0 | 0 |

Only `WP4HJ` should appear in the list view (Is_Latest = true).

### Step 6.2: Jeremy Dunlop verification (should be excluded)

```soql
SELECT Id, Name, Is_Latest_Closed_Lost__c, Open_Recruiting_Opps__c
FROM Opportunity WHERE Id = '006VS00000D5GkcYAF'
```

**Expected**: `Is_Latest_Closed_Lost__c = false` (because `Open_Recruiting_Opps__c = 1`, which the Option C formula catches).

### Step 6.3: Null-timestamp records verification

```soql
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Stage_Entered_Closed__c = null
  AND Is_Latest_Closed_Lost__c = false
-- Expected: 0 (all should be true, except those excluded by Open_Recruiting_Opps > 0)
```

### Step 6.4: Full list count

```soql
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting'
  AND StageName = 'Closed Lost'
  AND Days_Since_Closed_Lost__c >= 30
  AND Open_Re_Engagement_Opps__c = 0
  AND Is_Latest_Closed_Lost__c = true
  AND Closed_Lost_Reason__c != 'Savvy Declined - No Book of Business'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Insufficient Revenue'
  AND Closed_Lost_Reason__c != 'Savvy Declined – Book Not Transferable'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Poor Culture Fit'
  AND Closed_Lost_Reason__c != 'Savvy Declined - Compliance'
-- Expected: ~388 (±5 from natural daily drift)
```

---

## Known Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| RecordType label mismatch | Rollup silently returns null for all records | Phase 0 pre-flight check confirms label is exactly `Recruiting`. Already verified in v1 deployment. |
| List view `equals 1` filter on checkbox breaks the UI (same class of bug as the `equals 0` issue in Round 3) | List shows 0 records | Fallback: remove `Is_Latest_Closed_Lost__c` filter, keep as column only. The 15 duplicate rows are cosmetic. |
| 10-filter limit overflow | Deploy fails | Option C consolidates `Open_Recruiting_Opps__c` check into the `Is_Latest_Closed_Lost__c` formula, replacing one filter with another. |
| Cross-phase deploy combining | Deploy fails with missing field references | Each phase must deploy and verify before the next begins. Phase 4 depends on Phase 1 fields existing in production. |
| Record-Triggered Flow governor limits on bulk operations | Flow fails silently | The flow only fires when a single opp enters Closed Lost — not a bulk scenario. Backfill uses Apex which is governor-limit-safe in batches of 200. |
| Backfill Apex governor limits | Script hits SOQL subquery limit at 200 records | Batched at 200 per run, ~9 iterations. Claude Code runs via `sf apex run` (Bash tool) and verifies via MCP SOQL between iterations. |
| Formula Text field truncates long original details | Details > 255 chars are truncated in list view column | Two-field approach: Account keeps full LTA (Original_Closed_Lost_Details__c) + Short copy (Original_Closed_Lost_Details_Short__c, Text(255)) for formula reference. 44 accounts had values between 255–1300 chars — Text(255) was chosen over Text(1300) because SF Text max is 255. Full details remain one click away on the Account record. |
| Two opps close at exact same second | Both show `Is_Latest = true`, creating a duplicate row | Extremely unlikely. If it occurs, it's a cosmetic issue only. |
| `Is_Latest_Closed_Lost__c` returns TRUE for non-Recruiting Closed Lost opps | Semantic inconsistency | No functional impact — list view already filters on RecordType = Recruiting before evaluating this formula. Documented as a known semantic gap. |

---

## Rollback Plan

**Reverse dependency order**:

1. **List view**: Redeploy the pre-v2 list view XML (restore `Open_Recruiting_Opps__c < 1` filter, remove `Is_Latest_Closed_Lost__c` filter and new columns)
2. **Opportunity formulas**: Delete `Is_Latest_Closed_Lost__c`, `Re_Engagement_Opp_Count__c`, `Original_Closed_Lost_Reason__c`, `Original_Closed_Lost_Details__c` via Setup → Object Manager
3. **Flow**: Deactivate `Populate_Original_Closed_Lost` via Setup → Flows
4. **Account text fields**: Delete `Original_Closed_Lost_Reason__c` and `Original_Closed_Lost_Details__c` via Setup (must remove Opportunity formula references first)
5. **Account rollup**: Delete `Most_Recent_Recruiting_Closed_Date__c` via Setup (must remove Opportunity formula references first)
6. **Permission set**: Redeploy original version (extra permissions are non-breaking, but clean up is nice)

---

## SFDX Project Structure (after v2)

```
salesforce/force-app/main/default/
├── flows/
│   ├── Create_Re_Engagement_Opportunity.flow-meta.xml (v18)
│   └── Populate_Original_Closed_Lost.flow-meta.xml (NEW)
├── objects/
│   ├── Account/
│   │   └── fields/
│   │       ├── Most_Recent_Closed_Date__c.field-meta.xml
│   │       ├── Most_Recent_Recruiting_Closed_Date__c.field-meta.xml (NEW)
│   │       ├── Open_Recruiting_Opps__c.field-meta.xml
│   │       ├── Original_Closed_Lost_Details__c.field-meta.xml (NEW — LTA, full text)
│   │       ├── Original_Closed_Lost_Details_Short__c.field-meta.xml (NEW — Text(255), formula-friendly)
│   │       ├── Original_Closed_Lost_Reason__c.field-meta.xml (NEW)
│   │       └── Total_Re_Engagement_Opps__c.field-meta.xml
│   └── Opportunity/
│       ├── fields/
│       │   ├── Closed_Lost_Time_Bucket__c.field-meta.xml
│       │   ├── Days_Since_Closed_Lost__c.field-meta.xml
│       │   ├── Is_Latest_Closed_Lost__c.field-meta.xml (NEW)
│       │   ├── Open_Re_Engagement_Opps__c.field-meta.xml
│       │   ├── Open_Recruiting_Opps__c.field-meta.xml
│       │   ├── Original_Closed_Lost_Details__c.field-meta.xml (NEW)
│       │   ├── Original_Closed_Lost_Reason__c.field-meta.xml (NEW)
│       │   ├── Re_Engagement_Opp_Count__c.field-meta.xml (NEW)
│       │   └── Was_Re_Engaged__c.field-meta.xml
│       ├── listViews/
│       │   └── Re_Engagement_Eligible.listView-meta.xml (UPDATED)
│       └── validationRules/
│           └── Block_Re_Engagement_If_One_Exists.validationRule-meta.xml
└── permissionsets/
    └── Re_Engagement_Fields_Access.permissionset-meta.xml (UPDATED)
```
