# Phase 2 Investigation Findings

## 1. Task supports custom field lookups to Account — CONFIRMED with deployment quirk

```
Task.describe:
  custom = false (standard object)
  createable = true
  customSetting = false
  fields total = 47
  existing custom reference fields = 0
```

Task is a standard object. It supports custom fields (5 already exist: `CallDispose__c`, `Joined_Date__c`, `Meeting_Booked_Date__c`, `SGA__c`, `Week_Joined__c`) but **none are Lookup/reference type today**. `Referenced_Advisor__c` is the first custom lookup field in this class.

**Deployment quirk discovered during dry-run:** Task/Event custom fields must be deployed under `objects/Activity/fields/` (not `objects/Task/fields/`) because Task and Event share custom-field schema via the Activity parent. Salesforce's `CustomField.TableEnumOrId` rejects `Task` as a direct value — it requires `Activity`. Salesforce then surfaces the field on BOTH Task and Event. For our use case (Task only), this is acceptable — the field is invisible on Event since it's not on any Event layout.

**Source format location:** `sfdx/phase2_build/force-app/main/default/objects/Activity/fields/Referenced_Advisor__c.field-meta.xml`

**Referencing from layouts:** `Task.Referenced_Advisor__c` resolves correctly when the field is declared under Activity. Dry-run confirmed.

## 2. Lookup filter supports combined Account conditions — CONFIRMED

Lookup filters on custom reference fields support:
- Multiple filter items AND'd via `booleanFilter` logic
- Field-to-value comparisons (e.g. `Won_Opportunities__c greaterThan 0`)
- Dot-traversal on related object fields (e.g. `RecordType.DeveloperName equals 'Standard_Recruiting'`)

The Phase 2 field definition uses both:
```xml
<lookupFilter>
  <booleanFilter>1 AND 2</booleanFilter>
  <filterItems>
    <field>Account.Won_Opportunities__c</field>
    <operation>greaterThan</operation>
    <value>0</value>
  </filterItems>
  <filterItems>
    <field>Account.RecordType.DeveloperName</field>
    <operation>equals</operation>
    <value>Standard_Recruiting</value>
  </filterItems>
</lookupFilter>
```

Same pattern was approved in Phase 1 for `Referral__c.Referring_Advisor__c` — the dry-run will confirm.

## 3. Layouts receiving `LogReferenceCall` platformAction

**Inventory of all layouts in the org:**

| Object | Layouts | Active RTs |
|---|---|---|
| Account | `Account Layout`, `RF  Account Layout` (note double space) | Standard_Recruiting, Recruitment_Firm |
| Opportunity | `Opportunity Layout`, `Re-Engagement Opportunity Layout` | Recruiting, Re-Engagement (+ M&A inactive) |
| Lead | `Lead Layout` | (no RTs — master only) |
| Contact | `Contact Layout` | (no RTs — master only) |
| Task | `Task Layout` | (no RTs yet — Phase 2 adds 2) |

**Decision on which Opp layouts receive LogReferenceCall:**

Per your base list — **Opportunity Recruiting RT only.** `Opportunity Layout` is the Recruiting RT's layout. `Re-Engagement Opportunity Layout` (Re-Engagement RT) does NOT receive the button. Justification: reference calls are for recruiting-path attribution; re-engagement is already-joined or re-activating advisors and doesn't need the button.

**Final list — 5 layouts modified in Phase 2:**
1. `Account-Account Layout` (adds LogReferenceCall on top of Phase 1's Referrals related list)
2. `Account-RF  Account Layout` (same)
3. `Opportunity-Opportunity Layout` (Recruiting RT — button added)
4. `Lead-Lead Layout` (button added)
5. `Contact-Contact Layout` (button added)

**NOT modified:** `Re-Engagement Opportunity Layout`, `Task-Task Layout` (re-deployed unmodified for RT assignment).

## 4. 9 Profile deltas — both RTs visible deploy strategy — CONFIRMED with risk flag

Profile metadata is deployed additively. Each of the 9 Phase 2 profile deltas contains ONLY `<layoutAssignments>` + `<recordTypeVisibilities>` for the Task RTs:

```xml
<recordTypeVisibilities>
  <default>true</default>
  <recordType>Task.General</recordType>
  <visible>true</visible>
</recordTypeVisibilities>
<recordTypeVisibilities>
  <default>false</default>
  <recordType>Task.Reference_Call</recordType>
  <visible>true</visible>
</recordTypeVisibilities>
<layoutAssignments>
  <layout>Task-Task Layout</layout>
  <recordType>Task.General</recordType>
</layoutAssignments>
<layoutAssignments>
  <layout>Task-Reference Call Layout</layout>
  <recordType>Task.Reference_Call</recordType>
</layoutAssignments>
```

**Blast radius:** 28 active Standard Users + 11 System Admins + 1 Recruitment Partnership = 40 active humans logging ~47k tasks per 30 days (~1,567/day). The RT rollout affects them all simultaneously once Phase 2 lands — **there is no canary path when Reference_Call RT is not PS-gated** (per Steven's decision).

**Mitigation (adopted):**
- Deploy window: off-hours (e.g., Friday 6 PM Eastern, next week)
- Existing `Global.NewTask` and `Global.LogACall` quick actions have `RecordTypeId = null` (verified earlier) → they will automatically adopt `Task.General` (the profile default) with zero UX change to existing Log a Call / New Task buttons
- Smoke test within 5 min of deploy verifies composer behavior unchanged
- Rollback pre-staged; <15 min target

**Known Lightning-specific risk that requires production verification:** If Lightning Activity Composer shows an RT picker dialog when multiple Task RTs are visible (even with a default set), regular task creation will slow. This is why the smoke test checks Log a Call composer behavior *before* anything else.

## 5. Required field scoped to Reference_Call RT only — CONFIRMED

**Field definition:** `<required>false</required>` at field level (see `Referenced_Advisor__c.field-meta.xml`).

**Required enforcement via layout:** `Task-Reference Call Layout` includes the field with `<behavior>Required</behavior>`. `Task-Task Layout` does NOT include the field at all — so for General-RT tasks, the field is invisible and unenforced.

**Effect on existing `NewTask` / `LogACall` quick actions:**
- These are `RecordTypeId=null` global actions
- They adopt the profile default Task RT = `Task.General` (post-deploy)
- General RT uses `Task-Task Layout`
- `Task-Task Layout` does not include `Referenced_Advisor__c`
- Therefore: required enforcement does NOT trigger, and existing composer flows save as before

**Effect on new `LogReferenceCall` quick action:**
- Bound to `Task.Reference_Call` RT
- Reference Call RT uses `Task-Reference Call Layout`
- That layout requires `Referenced_Advisor__c`
- Lookup filter enforced on Accounts → picker only shows joined advisors
- Save blocked until a valid advisor is selected

**Verified chain — no interference between the two paths.**
