# Phase 1 Build Spec — Referral__c + Attribution Flows

**Target org:** `savvy` (production, `https://savvywealth.my.salesforce.com`)
**Deploy window:** Friday 6 PM Eastern
**Deploy method:** `sf project deploy start --source-dir force-app`
**Scope:** Phase 1 ONLY. Phase 2 (Task Reference Call) lands next week in a separate deploy — see `phase2_build/BUILD_SPEC.md`.

---

## 1. Scope

RevOps records that a joined advisor referred a prospect firm. Cascades `Final_Source__c = 'Advisor Referral'` onto the prospect's open Recruiting Opportunities via flow.

**Not in Phase 1:** Task Reference Call, Task record types, any Task-side changes. Deferred to Phase 2.
**Not in Phase 1:** `Date_of_Last_Referral__c` deprecation. Deferred to follow-up deploy 2 weeks post-launch.

---

## 2. Components inventory (13 files)

| Type | Name | Purpose |
|---|---|---|
| CustomObject | `Referral__c` | Referral junction |
| CustomField | `Referral__c.Prospect_Account__c` | Master-detail → Account (prospect) |
| CustomField | `Referral__c.Referring_Advisor__c` | Lookup → Account, filtered to `Won_Opportunities__c > 0 AND RecordType = Standard_Recruiting` |
| CustomField | `Referral__c.Referral_Date__c` | Date, user-entered |
| CustomField | `Referral__c.Notes__c` | LongText 32K |
| CustomField | `Referral__c.Referral_Key__c` | Text(40), Unique, External Id, case-insensitive; populated by before-save flow |
| Layout | `Referral__c-Referral Layout` | Default layout for Referral__c |
| Layout (modified) | `Account-Account Layout` | + Referrals related list after RelatedOpportunityList |
| Layout (modified) | `Account-RF  Account Layout` | Same |
| Flow | `Referral_Set_Referral_Key` | Before-save Create → populates Referral_Key__c |
| Flow | `Referral_Set_Final_Source_on_Open_Opps` | After-save Create → updates open Recruiting Opps where Final_Source__c IS NULL |
| Flow | `Opportunity_Set_Final_Source_on_Create_When_Referral_Exists` | Before-save Opp Create → sets Final_Source__c + Finance_View__c when Referral exists for AccountId |
| PermissionSet | `RevOps` | CRUD + FLS on Referral__c |
| PermissionSetGroup | `Referral_RevOps` (label "Referral RevOps") | Contains `RevOps` PS. API renamed to avoid label collision surfaced during dry-run. |

---

## 3. Data model

```
Account (Recruitment_Firm — the prospect)
  └─< Referral__c (Prospect_Account__c master-detail)
        └─> Account (Standard_Recruiting, Won_Opportunities__c > 0 — the referring advisor)
```

Joined-advisor filter: `Won_Opportunities__c > 0`. Native rollup, verified 0-delta match against baseline (99 = 99).
Uniqueness: `Referral_Key__c = Prospect_Account__c & '|' & Referring_Advisor__c`, Unique + External Id + case-insensitive. Allows joint referrals, blocks exact duplicates.

---

## 4. Flow logic

### Flow 1 — `Referral_Set_Referral_Key`
Before-save on Referral__c Create. Assigns `Referral_Key__c = Prospect_Account__c & '|' & Referring_Advisor__c`.

### Flow A — `Referral_Set_Final_Source_on_Open_Opps`
After-save on Referral__c Create. Filters Opportunity where:
```
AccountId = $Record.Prospect_Account__c
AND RecordType.DeveloperName = 'Recruiting'
AND IsClosed = false
AND Final_Source__c IS NULL
```
Sets `Final_Source__c = 'Advisor Referral'`. Downstream (same transaction): existing `Marketing: Update Finance View on Opp's Final Source Update` flow fires on the Update and sets `Finance_View__c = 'Advisor Referral'` via identity mapping. Flow A does NOT write Finance_View__c directly.

### Flow B — `Opportunity_Set_Final_Source_on_Create_When_Referral_Exists`
Before-save on Opportunity Create. Entry: `ISBLANK(TEXT(Final_Source__c)) && NOT(ISBLANK(TEXT(AccountId)))`. Gets first `Referral__c` where `Prospect_Account__c = $Record.AccountId`. If found, assigns `Final_Source__c = 'Advisor Referral'` AND `Finance_View__c = 'Advisor Referral'` (explicit — existing Finance_View flows don't fire on Create).

Re-engagement non-conflict: `Opportunity - Create Recruiting Opp on Re-Engagement Conversion` hardcodes `Final_Source__c = 'Re-Engagement'`, so Flow B's NULL filter no-ops.

---

## 5. Permissions

| Object | Default profile access | RevOps PSG |
|---|---|---|
| `Referral__c` Read | ❌ | ✅ |
| `Referral__c` Create/Edit/Delete | ❌ | ✅ |
| Referral__c field FLS | ❌ | ✅ (editable except Referral_Key__c = read-only) |

Sys Admins bypass FLS via Modify All Data; PSG is belt-and-suspenders for Russell/Kenji/Jed (assigned post-deploy).

---

## 6. Smoke test (Russell, <5 min after deploy)

| # | Action | Expected | Failure |
|---|---|---|---|
| 1 | Open any RF Account | Page loads | ROLLBACK |
| 2 | Scroll to Related Lists | "Referrals" list visible after Opportunities | ROLLBACK |
| 3 | App Launcher → Referrals → New | Create form opens | ROLLBACK |
| 4 | Pick a prospect Account + joined advisor + save | Referral created; Referral_Key__c = `<prospectId>|<advisorId>` | ROLLBACK |
| 5 | Try duplicate (same prospect + same advisor) | Unique constraint rejects save | ROLLBACK |
| 6 | Open the prospect's open Recruiting Opp | `Final_Source__c = 'Advisor Referral'` AND `Finance_View__c = 'Advisor Referral'` (via flow chain in same transaction) | ROLLBACK |
| 7 | Try Referring Advisor picker for a non-joined Account | Not in results (filter working) | ROLLBACK |

Post-deploy data check:
```sql
SELECT COUNT(Id) FROM Opportunity WHERE Final_Source__c = 'Advisor Referral'
-- Baseline: 52. Should be 52 + N (where N = test referrals created)
```

---

## 7. Rollback plan (<15 min target)

Pre-staged at `sfdx/rollback/`.

1. Unassign RevOps PSG from Russell/Kenji/Jed (if assigned) — `sf data delete record` × 3
2. Revert 2 Account layouts to pre-deploy state:
   ```
   cd sfdx && sf project deploy start --target-org savvy \
     --source-dir rollback/force-app --wait 15 --test-level NoTestRun
   ```
3. Delete Phase 1 components:
   ```
   cd sfdx && sf project deploy start --target-org savvy \
     --manifest rollback/package.xml \
     --post-destructive-changes rollback/destructiveChanges.xml \
     --wait 15 --test-level NoTestRun
   ```

Destructive manifest (`rollback/destructiveChanges.xml`) deletes:
- `Flow: 3 Phase 1 flows`
- `PermissionSetGroup: RevOps`
- `PermissionSet: RevOps`
- `Layout: Referral__c-Referral Layout`
- `CustomObject: Referral__c`

---

## 8. Decisions encoded

| # | Decision | Source |
|---|---|---|
| D1 | `Won_Opportunities__c > 0` as joined-advisor filter | T1 — 0-delta baseline |
| D2 | `Finance_View__c = 'Advisor Referral'` (identity mapping, NOT `'Referral'`) | B1 — 52/52 prod rows |
| D3 | Re-engagement flow doesn't conflict (Final_Source IS NULL filter) | B2 |
| D4 | `Referral_Key__c` formula: `Prospect_Account__c & '|' & Referring_Advisor__c` (no LEFT) | User decision |
| D5 | Joint referrals allowed; exact duplicate pairs blocked | User decision |
| D6 | Date_of_Last_Referral__c deprecation deferred 2 weeks | User decision |
| D7 | Flow A relies on same-transaction Update-triggered Finance_View flow | Flow execution order |
| D8 | Task-side Phase 2 deferred — Shared Activities can't do multi-Account, simpler design adopted per Steven | Investigation + Slack |

---

## 9. File tree (Phase 1)

```
sfdx/
├── sfdx-project.json
├── BUILD_SPEC.md                ← this file
├── DEPLOY_RUNBOOK.md
├── force-app/main/default/
│   ├── objects/Referral__c/Referral__c.object-meta.xml
│   ├── objects/Referral__c/fields/{5 fields}.field-meta.xml
│   ├── layouts/Referral__c-Referral Layout.layout-meta.xml
│   ├── layouts/Account-Account Layout.layout-meta.xml (modified)
│   ├── layouts/Account-RF  Account Layout.layout-meta.xml (modified)
│   ├── flows/{3 flows}.flow-meta.xml
│   ├── permissionsets/RevOps.permissionset-meta.xml
│   └── permissionsetgroups/RevOps.permissionsetgroup-meta.xml
└── rollback/
    ├── package.xml
    ├── destructiveChanges.xml
    └── force-app/main/default/layouts/{2 original Account layouts}
```

Phase 2 components live in `sfdx/phase2_build/` — separate deploy next week.
Old junction-object design archived in `sfdx/phase2_deprecated/` for reference.
