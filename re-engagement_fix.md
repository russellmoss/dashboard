# Re-Engagement Repeat Eligibility -- Exploration & Fix

**Date:** 2026-03-17
**Investigated by:** Claude Code (MCP Salesforce queries against `savvy` org)

---

## 1. Screen Flow Validation Logic

### Flow Identification

```soql
-- Tooling API
SELECT Id, Definition.DeveloperName, VersionNumber, Status, ProcessType
FROM Flow
WHERE Definition.DeveloperName = 'Create_Re_Engagement_Opportunity' AND Status = 'Active'
```

**Result:**
- Flow Id: `301VS00000c4MYoYAM`
- Version: 16
- Status: Active
- ProcessType: Flow (Screen Flow)

### Flow Logic (from Metadata)

The flow has **two Record Lookups** that feed into a single **Decision** element:

#### Record Lookup: `Get_Open_ReEngagement_Opportunities`
- **Description:** "Check if there is an existing open re-engagement opportunity on the account (any stage other than Re-Engaged)"
- **Object:** Opportunity
- **Filter Logic:** AND
  - `AccountId` EqualTo `recordID.Account.Id`
  - `RecordTypeId` EqualTo `ReEngagementRecordTypeID`
  - `StageName` NotEqualTo `Re-Engaged`

#### Record Lookup: `Get_Open_Recruiting_Opportunities`
- **Description:** "Check if there is an existing open recruiting opportunity on the account (any stage other than Closed Lost or Joined)"
- **Object:** Opportunity
- **Filter Logic:** 1 AND 2 AND 3 AND 4
  - `AccountId` EqualTo `AccountLookup.recordId`
  - `RecordTypeId` EqualTo `RecruitingRecordTypeID`
  - `StageName` NotEqualTo `Closed Lost`
  - `StageName` NotEqualTo `Joined`

#### Decision: `Check_For_Open_Opportunities`
- **Description:** "Check if there are any open re-engagement or recruiting opportunities on the account before creating a new re-engagement opportunity"
- **Rule 1 — "Has Open Re-Engagement":** If `Get_Open_ReEngagement_Opportunities` IsNull = false -> show blocking screen
- **Rule 2 — "Has Open Recruiting":** If `Get_Open_Recruiting_Opportunities` IsNull = false -> show blocking screen
- **Default — "No Open Opportunities":** Proceed to `Get_New_Owner_ID` (create the opp)

### THE BUG

The Re-Engagement lookup (`Get_Open_ReEngagement_Opportunities`) only excludes `StageName != 'Re-Engaged'`. This means:

| Stage | Treated as "open" by flow? | Actually open? |
|---|---|---|
| Planned Nurture | Yes (blocked) | Yes -- correct |
| Outreach | Yes (blocked) | Yes -- correct |
| Call Scheduled | Yes (blocked) | Yes -- correct |
| Engaged | Yes (blocked) | Yes -- correct |
| **Closed Lost** | **Yes (blocked)** | **No -- BUG** |
| Re-Engaged | No (allowed) | No -- correct |

**Closed Lost re-engagement opps are incorrectly treated as "open" and block creation of new re-engagement opps.**

Compare with the Recruiting lookup which correctly excludes BOTH `Closed Lost` AND `Joined`.

### Blocking Screen Text

When the flow finds a "Closed Lost" re-engagement opp, it shows:

> **Cannot Create Re-Engagement Opportunity**
>
> There is already an existing open re-engagement opportunity for this advisor.
>
> Please close or update the existing re-engagement opportunity before creating a new one.

This is misleading because the opp IS already closed.

---

## 2. Account Rollup Field

### Field Definition

```soql
-- Tooling API
SELECT Id, QualifiedApiName, DataType, Description
FROM FieldDefinition
WHERE EntityDefinition.QualifiedApiName = 'Account'
  AND QualifiedApiName = 'Open_Re_Engagement_Opps__c'
```

**Result:**
- QualifiedApiName: `Open_Re_Engagement_Opps__c`
- DataType: **Roll-Up Summary (COUNT Opportunity)**
- Description: "Number of Open Re-Engagement Opportunitites"

### Rollup Filter (from CustomField Metadata)

```soql
-- Tooling API
SELECT Id, DeveloperName, Metadata
FROM CustomField
WHERE DeveloperName = 'Open_Re_Engagement_Opps' AND TableEnumOrId = 'Account'
```

**Rollup filter items:**
1. `Opportunity.RecordTypeId` equals `Re-Engagement`
2. `Opportunity.StageName` notEqual `Closed Lost, Re-Engaged`

**The rollup field is CORRECT.** It excludes both "Closed Lost" and "Re-Engaged" from the count. For the example account (Alejandro Rubinstein), `Open_Re_Engagement_Opps__c = 0` even though a Closed Lost re-engagement opp exists.

### Key Discrepancy

| Component | Excludes from "open" count |
|---|---|
| **Account rollup field** | Closed Lost, Re-Engaged (correct) |
| **Screen Flow lookup** | Re-Engaged only (missing Closed Lost -- BUG) |

The rollup and the flow are inconsistent. The rollup says "0 open re-engagement opps" but the flow still blocks creation because its query finds the Closed Lost opp.

### Example Account Verification

```soql
SELECT Account.Name, Account.Open_Re_Engagement_Opps__c
FROM Opportunity WHERE Id = '006VS000005janeYAA'
```

- Account: **Alejandro Rubinstein - Account** (001VS000006IHqAYAW)
- `Open_Re_Engagement_Opps__c`: **0**

---

## 3. Re-Engagement Opp Linkage

### Lookup Fields on Opportunity

Two cross-reference lookups exist:

| Field | Type | Direction |
|---|---|---|
| `Source_Re_Engagement_Opportunity_ID__c` | Lookup(Opportunity) | On the new Recruiting opp, points back to the Re-Engagement opp that spawned it |
| `Created_Recruiting_Opportunity_ID__c` | Lookup(Opportunity) | On the Re-Engagement opp, points to the new Recruiting opp created from it |
| `SGM_reengagement__c` | Lookup(User) | SGM assigned for re-engagement |

No "Original" or "Parent" lookup fields exist (0 results for both queries).

### Linkage Population

```soql
SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Re_Engagement' AND Created_Recruiting_Opportunity_ID__c != null
-- Result: 20

SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Recruiting' AND Source_Re_Engagement_Opportunity_ID__c != null
-- Result: 21

SELECT COUNT(Id) FROM Opportunity
WHERE RecordType.DeveloperName = 'Re_Engagement' AND Created_Recruiting_Opportunity_ID__c = null
-- Result: 844
```

**Only 20 of 864 re-engagement opps (2.3%) have the `Created_Recruiting_Opportunity_ID__c` populated.** These linkage fields were likely added in a recent flow version and only apply to newly re-engaged records.

### Connection Method

Re-engagement opps connect to their original recruiting opps via **AccountId** (same account). Example:

```soql
SELECT Id, Name, RecordType.DeveloperName, StageName, CloseDate
FROM Opportunity WHERE AccountId = '001VS000006IHqAYAW' ORDER BY CreatedDate
```

| Opp | RecordType | Stage | CloseDate |
|---|---|---|---|
| Alejandro Rubinstein (006VS000005janeYAA) | Recruiting | Closed Lost | 2024-08-06 |
| [Re-Engagement] Alejandro Rubinstein (006VS00000Pos6sYAB) | Re_Engagement | Closed Lost | 2025-12-31 |

Both link fields (`Source_Re_Engagement_Opportunity_ID__c`, `Created_Recruiting_Opportunity_ID__c`) are **null** on these records -- confirming this is an older pair without the cross-reference.

---

## 4. Data Landscape

### Re-Engagement Opps by Stage

```soql
SELECT StageName, COUNT(Id) ct FROM Opportunity
WHERE RecordType.DeveloperName = 'Re_Engagement'
GROUP BY StageName ORDER BY COUNT(Id) DESC
```

| Stage | Count |
|---|---|
| Planned Nurture | 556 |
| Closed Lost | 205 |
| Outreach | 50 |
| Re-Engaged | 42 |
| Call Scheduled | 7 |
| Engaged | 4 |
| **Total** | **864** |

### Summary

- **864** total re-engagement opps
- **617** currently open (not closed) -- includes Planned Nurture, Outreach, Call Scheduled, Engaged
- **205** Closed Lost -- these are the ones incorrectly blocking repeat re-engagement
- **42** Re-Engaged (successfully converted back to Recruiting pipeline)

### Accounts with Multiple Re-Engagement Opps

10 accounts have 2+ re-engagement opps (one account has 4). This shows repeat re-engagement does happen and is a valid workflow.

### Impact of the Bug

The 205 Closed Lost re-engagement opps represent **advisors who were re-engaged, it didn't work out, and they cannot be re-engaged again** via the screen flow because the Closed Lost opp blocks new creation.

---

## 5. Days Since Closed Lost -- Example Record

### Original Recruiting Opp

```soql
SELECT Id, Name, CloseDate, Stage_Entered_Closed__c, Days_Since_Closed_Lost__c, AccountId
FROM Opportunity WHERE Id = '006VS000005janeYAA'
```

| Field | Value |
|---|---|
| Name | Alejandro Rubinstein |
| CloseDate | 2024-08-06 |
| Stage_Entered_Closed__c | 2024-07-18T16:11:17.000Z |
| Days_Since_Closed_Lost__c | **607** |
| AccountId | 001VS000006IHqAYAW |

### Re-Engagement Opp (also Closed Lost)

```soql
SELECT Id, Name, CloseDate, Stage_Entered_Closed__c, StageName, AccountId
FROM Opportunity WHERE Id = '006VS00000Pos6sYAB'
```

| Field | Value |
|---|---|
| Name | [Re-Engagement] Alejandro Rubinstein |
| CloseDate | 2025-12-31 |
| Stage_Entered_Closed__c | 2026-02-09T21:10:08.000Z |
| StageName | Closed Lost |
| AccountId | 001VS000006IHqAYAW |

### Timeline

1. **2024-07-18** -- Original recruiting opp closed lost
2. **~2025** -- Re-engagement opp created (exact date not queried but before 2025-12-31 close date)
3. **2026-02-09** -- Re-engagement opp also closed lost
4. **Now** -- Account has `Open_Re_Engagement_Opps__c = 0` (rollup correct), but flow would still block a second re-engagement attempt because the Closed Lost re-engagement opp has `StageName != 'Re-Engaged'`

---

## Proposed Solution

### Root Cause

The Screen Flow `Create_Re_Engagement_Opportunity` (v16) has a Record Lookup (`Get_Open_ReEngagement_Opportunities`) that checks for re-engagement opps where `StageName != 'Re-Engaged'`. This filter is missing an exclusion for `Closed Lost`, causing Closed Lost re-engagement opps to be treated as "open" and blocking new re-engagement opp creation.

The Account rollup field `Open_Re_Engagement_Opps__c` is correctly configured (excludes both Closed Lost and Re-Engaged), but the flow does NOT use this field -- it runs its own SOQL query.

### Fix 1: Screen Flow -- Add Closed Lost Exclusion (PRIMARY FIX)

**What to change:** In the `Get_Open_ReEngagement_Opportunities` Record Lookup element, add a second filter:

Current filters:
1. `AccountId` = context Account Id
2. `RecordTypeId` = Re-Engagement
3. `StageName` != `Re-Engaged`

Add filter #4:
4. `StageName` != `Closed Lost`

This makes the flow consistent with the rollup field and the Recruiting lookup (which already excludes both Closed Lost and Joined).

**How to implement:**
- Open Flow Builder: Setup > Flows > `Create_Re_Engagement_Opportunity`
- Edit the `Get Open Re-Engagement Opportunities` Record Lookup element
- Add filter condition: `StageName` does not equal `Closed Lost`
- Save as new version (v17) and Activate

### Fix 2: No New Formula Fields Needed

The existing `Open_Re_Engagement_Opps__c` rollup field is already correct. No new fields are required.

### Fix 3: No List View Changes Needed for This Bug

The bug is purely in the Screen Flow validation logic. List views are not involved.

### Optional Enhancement: Use Rollup Field Instead of SOQL Lookup

Instead of the flow running its own SOQL query, it could check `Account.Open_Re_Engagement_Opps__c > 0`. This would:
- Eliminate the discrepancy between rollup and flow logic
- Be more performant (no query, just a field check)
- Stay in sync automatically if rollup filters are updated

However, this is a bigger refactor and the simple filter fix is safer for now.

### Phased Implementation Plan

#### Phase 1: Flow Fix (immediate, low risk)
1. Clone the active flow version as a backup
2. Edit `Get_Open_ReEngagement_Opportunities` to add `StageName != 'Closed Lost'` filter
3. Save as new version (v17)
4. **Test:** Try to create a re-engagement opp for Alejandro Rubinstein (account 001VS000006IHqAYAW) -- should now be allowed since the only re-engagement opp is Closed Lost
5. **Test:** Verify that accounts with truly open re-engagement opps (Planned Nurture, Outreach, etc.) are still blocked
6. Activate v17

#### Phase 2: Validation (same day)
1. Verify `Open_Re_Engagement_Opps__c` remains accurate (it should -- no change to rollup)
2. Spot-check 3-5 accounts from the 205 Closed Lost re-engagement pool to confirm they can now have new re-engagement opps created
3. Confirm no regression on the "Has Open Recruiting" check

#### Phase 3: Data Review (optional, next sprint)
1. Review the 205 Closed Lost re-engagement opps to identify candidates for repeat re-engagement
2. Consider whether `Created_Recruiting_Opportunity_ID__c` / `Source_Re_Engagement_Opportunity_ID__c` should be backfilled for the 844 older re-engagement opps missing these cross-references
3. Consider the optional enhancement of switching the flow to use the rollup field instead of SOQL

---

## Appendix: Raw Query Results Summary

| Query | Result |
|---|---|
| Total Re-Engagement opps | 864 |
| Re-Engagement Closed Lost | 205 |
| Re-Engagement Open (not closed) | 617 |
| Re-Engagement Re-Engaged | 42 |
| Re-Engagement with Created_Recruiting link | 20 (2.3%) |
| Recruiting with Source_Re_Engagement link | 21 |
| Accounts with 2+ re-engagement opps | 10 |
| Flow version | 16 (Active) |
| Rollup excludes | Closed Lost, Re-Engaged (correct) |
| Flow lookup excludes | Re-Engaged only (BUG) |
